import { getRequestConfig } from "next-intl/server";
import { getLocale } from "@/lib/locale-server";

export default getRequestConfig(async () => {
  const locale = await getLocale();

  return {
    locale,
    messages: (
      (await import(`../messages/${locale}.json`)) as { default: Record<string, unknown> }
    ).default,
  };
});
