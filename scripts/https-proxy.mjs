#!/usr/bin/env node
/**
 * HTTPS in front of a local `next start`, for testing on a phone.
 *
 * Face ID unlock is a passkey (WebAuthn), and iOS only offers passkeys on a
 * secure page whose certificate it trusts, under a domain name (not a bare
 * IP). This terminates TLS with a mkcert certificate (.certs/, gitignored)
 * and forwards to the app on plain HTTP, marking the request as forwarded
 * HTTPS so the app builds https URLs and secure cookies.
 *
 *   node scripts/https-proxy.mjs [listenPort=3443] [targetPort=3001]
 *
 * Start the app with AUTH_URL set to the https address, so passkeys are
 * registered for that host rather than localhost:
 *
 *   AUTH_URL=https://<mac>.local:3443 next start -H 0.0.0.0 -p 3001
 *
 * The phone must trust the mkcert root CA once: AirDrop
 * "$(mkcert -CAROOT)/rootCA.pem", install the profile, then enable it under
 * Settings → General → About → Certificate Trust Settings.
 */
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const listenPort = Number(process.argv[2] ?? 3443);
const targetPort = Number(process.argv[3] ?? 3001);
const certDir = new URL("../.certs/", import.meta.url);

const server = https.createServer(
  {
    cert: readFileSync(new URL("local.pem", certDir)),
    key: readFileSync(new URL("local-key.pem", certDir)),
  },
  (req, res) => {
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          "x-forwarded-proto": "https",
          "x-forwarded-host": req.headers.host ?? "",
          "x-forwarded-for": req.socket.remoteAddress ?? "",
        },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`App on :${targetPort} is not reachable (${error.code ?? error.message}).`);
    });
    req.pipe(upstream);
  },
);

// One line per connection problem and per page request, so a phone that
// "cannot open" the address shows why: no line at all means it never reached
// this Mac; a TLS line means it reached it but refused the certificate.
server.on("tlsClientError", (error, socket) => {
  console.log(`${new Date().toISOString()} TLS refused by ${socket.remoteAddress}: ${error.code ?? error.message}`);
});
server.on("secureConnection", (socket) => {
  console.log(`${new Date().toISOString()} TLS ok from ${socket.remoteAddress} (${socket.servername ?? "no SNI"})`);
});
server.on("request", (req) => {
  if (req.headers.accept?.includes("text/html")) {
    console.log(`${new Date().toISOString()} ${req.method} ${req.headers.host}${req.url} from ${req.socket.remoteAddress}`);
  }
});

// WebSocket and other upgrades pass straight through.
server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(targetPort, "127.0.0.1", () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
});

server.listen(listenPort, "0.0.0.0", () => {
  console.log(`HTTPS on :${listenPort} → http://127.0.0.1:${targetPort}`);
});
