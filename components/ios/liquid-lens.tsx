"use client";

import { useEffect } from "react";

/**
 * Edge refraction for Liquid Glass — Chromium only, progressive enhancement.
 *
 * Chromium can run an SVG filter on an element's backdrop
 * (`backdrop-filter: url(#lens) blur(…)`); WebKit cannot (bug 245510), so on
 * iPhone the glass stays frosted with a lit rim, which is what most of the
 * native look is at these sizes. Firefox claims support in @supports and then
 * draws nothing, so the gate is `navigator.userAgentData`, which only
 * Chromium ships.
 *
 * For every distinct glass size a displacement map is painted once on a
 * canvas: inside a bezel band along the rounded-rect edge, each pixel points
 * inward along the edge normal, strongest at the rim and fading with a
 * squared falloff — a convex lens' profile. feDisplacementMap then samples
 * the backdrop from further inside near the edge, which is the bending you
 * see on the tab bar as content scrolls under it. The filter id is set as a
 * custom property the .glass rule already consumes.
 */
const BEZEL = 14;
const STRENGTH = 26;
const MAX_SIDE = 720;

const cache = new Map<string, string>();

function ensureDefs(): SVGDefsElement {
  let svg = document.getElementById("liquid-lens-defs") as SVGSVGElement | null;
  if (svg === null) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "liquid-lens-defs";
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    svg.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "defs"));
    document.body.appendChild(svg);
  }
  return svg.firstChild as SVGDefsElement;
}

function displacementMap(w: number, h: number, r: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return "";
  const image = ctx.createImageData(w, h);
  const radius = Math.min(r, w / 2, h / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Signed distance to the rounded rect (positive inside) and its normal.
      const px = x + 0.5 - w / 2;
      const py = y + 0.5 - h / 2;
      const qx = Math.abs(px) - (w / 2 - radius);
      const qy = Math.abs(py) - (h / 2 - radius);
      let d: number;
      let nx: number;
      let ny: number;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy);
        d = radius - len;
        nx = (-Math.sign(px) * qx) / (len || 1);
        ny = (-Math.sign(py) * qy) / (len || 1);
      } else if (qx > qy) {
        d = radius - qx;
        nx = -Math.sign(px);
        ny = 0;
      } else {
        d = radius - qy;
        nx = 0;
        ny = -Math.sign(py);
      }
      const t = d <= 0 ? 0 : Math.max(0, 1 - d / BEZEL);
      const m = t * t;
      const i = (y * w + x) * 4;
      image.data[i] = 128 + nx * m * 127;
      image.data[i + 1] = 128 + ny * m * 127;
      image.data[i + 2] = 128;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

function filterFor(w: number, h: number, r: number): string {
  const key = `${w}x${h}r${r}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const id = `lens-${key}`;
  const ns = "http://www.w3.org/2000/svg";
  const filter = document.createElementNS(ns, "filter");
  filter.id = id;
  filter.setAttribute("x", "0");
  filter.setAttribute("y", "0");
  filter.setAttribute("width", String(w));
  filter.setAttribute("height", String(h));
  filter.setAttribute("filterUnits", "userSpaceOnUse");
  filter.setAttribute("color-interpolation-filters", "sRGB");
  const map = document.createElementNS(ns, "feImage");
  map.setAttribute("href", displacementMap(w, h, r));
  map.setAttribute("x", "0");
  map.setAttribute("y", "0");
  map.setAttribute("width", String(w));
  map.setAttribute("height", String(h));
  map.setAttribute("result", "map");
  const displace = document.createElementNS(ns, "feDisplacementMap");
  displace.setAttribute("in", "SourceGraphic");
  displace.setAttribute("in2", "map");
  displace.setAttribute("scale", String(STRENGTH));
  displace.setAttribute("xChannelSelector", "R");
  displace.setAttribute("yChannelSelector", "G");
  filter.append(map, displace);
  ensureDefs().appendChild(filter);
  const value = `url(#${id})`;
  cache.set(key, value);
  return value;
}

function apply(element: HTMLElement): void {
  const w = Math.round(element.offsetWidth);
  const h = Math.round(element.offsetHeight);
  if (w === 0 || h === 0 || w > MAX_SIDE || h > MAX_SIDE) {
    element.style.removeProperty("--glass-lens");
    return;
  }
  // Not parseFloat: the lint bans it app-wide to keep money out of floats.
  const radius = Math.round(
    Number(getComputedStyle(element).borderTopLeftRadius.replace("px", "")) || 0,
  );
  element.style.setProperty(
    "--glass-lens",
    filterFor(w, h, Math.min(radius, Math.floor(w / 2), Math.floor(h / 2))),
  );
}

export function LiquidLens() {
  useEffect(() => {
    if (!("userAgentData" in navigator)) return;
    if (window.matchMedia("(prefers-reduced-transparency: reduce)").matches) return;
    let cancelled = false;
    let teardown: () => void = () => undefined;

    /*
     * Only after hydration has finished: the lens writes an inline custom
     * property on server-rendered elements, and doing that while React is
     * still hydrating them reads as a mismatch. `load` fires after the
     * streamed HTML is complete; the idle wait lets hydration catch up.
     */
    const start = () => {
      if (cancelled) return;
      teardown = attach();
    };
    const idle = () => {
      window.setTimeout(start, 400);
    };
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", idle);
      teardown();
    };
  }, []);
  return null;
}

function attach(): () => void {
    document.documentElement.classList.add("lens");

    const sized = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.target as HTMLElement);
    });
    const watch = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>(".glass").forEach((element) => {
        sized.observe(element);
      });
    };
    watch(document);
    const added = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.classList.contains("glass")) sized.observe(node);
          watch(node);
        });
      }
    });
    added.observe(document.body, { childList: true, subtree: true });
    return () => {
      added.disconnect();
      sized.disconnect();
    };
}
