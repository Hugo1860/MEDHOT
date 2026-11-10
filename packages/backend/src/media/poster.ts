// Share posters (1080×1440 PNG) for articles, made for phones: saved from the page or long-pressed in
// chat apps. Same font pipeline as the share cards; the QR code opens the article on the site.
import { createHash } from "node:crypto";
import { renderSVG } from "uqr";
import { SITE } from "@aihot/site";
import { brandMark, clamp, FALLBACK_FONTS, h, nameMark, renderPng, SITE_HOST, type Node } from "./og.ts";

export const POSTER_TEMPLATE_VERSION = "poster-2026-11-10.2";
const WIDTH = 1080;
const HEIGHT = 1440;

export interface Poster {
  url: string;
  kicker: string;
  title: string;
  originalTitle?: string | null;
  summary: string | null;
  source: string;
  date: string;
  score: number | null;
}

const INK = "#17202a";
const MUTED = "#667085";
const ACCENT = "#4b2aad";
const BLUE = "#356dcb";

async function tree(p: Poster): Promise<Node> {
  const title = clamp(p.title, 60);
  const len = [...title].length;
  const titleSize = len > 42 ? 50 : len > 28 ? 56 : 62;
  const originalTitle = p.originalTitle && p.originalTitle.trim() !== p.title.trim() ? clamp(p.originalTitle, 100) : null;
  const summary = p.summary ? clamp(p.summary, len > 42 ? 120 : len > 28 ? 145 : 165) : "暂无可用摘要，请扫码查看详情与原文。";
  const qr = `data:image/svg+xml;base64,${Buffer.from(renderSVG(p.url, { border: 0, ecc: "M", blackColor: INK, whiteColor: "#ffffff" })).toString("base64")}`;
  const mark = await brandMark("icon.png", 58);
  return h(
    "div",
    {
      width: WIDTH,
      height: HEIGHT,
      display: "flex",
      flexDirection: "column",
      padding: "32px",
      fontFamily: "Noto Sans SC",
      color: INK,
      backgroundColor: "#edf2f7",
      backgroundImage: "radial-gradient(circle at 100% 0%, rgba(75,42,173,0.12), rgba(237,242,247,0) 44%), radial-gradient(circle at 0% 100%, rgba(53,109,203,0.10), rgba(237,242,247,0) 42%)",
    },
    h("div", {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      padding: "48px 54px 38px",
      borderRadius: 44,
      backgroundColor: "#ffffff",
      boxShadow: "0 2px 4px rgba(23,32,42,0.05), 0 18px 44px rgba(23,32,42,0.09)",
    }, [
      h("div", { display: "flex", alignItems: "center", justifyContent: "space-between" }, [
        h("div", { display: "flex", alignItems: "center" }, [
          mark ?? nameMark(34, INK, ACCENT),
          mark ? h("div", { display: "flex", flexDirection: "column", marginLeft: 16 }, [
            h("div", { display: "flex", fontSize: 32, fontWeight: 700, color: INK }, SITE.name),
            h("div", { display: "flex", marginTop: 2, fontSize: 20, color: MUTED, letterSpacing: 0.5 }, "临床要闻 · Clinical Brief"),
          ]) : null,
        ].filter(Boolean)),
        p.score !== null
          ? h("div", { display: "flex", padding: "7px 16px", borderRadius: 999, backgroundColor: "rgba(75,42,173,0.09)", fontSize: 22, fontWeight: 700, color: ACCENT }, `精选 ${Math.round(p.score)}`)
          : h("div", { display: "flex", fontSize: 22, color: MUTED }, p.date),
      ]),
      h("div", { display: "flex", marginTop: 40, fontSize: titleSize, fontWeight: 700, lineHeight: 1.28, color: INK }, title),
      originalTitle ? h("div", { display: "flex", marginTop: 18, fontSize: 25, lineHeight: 1.42, color: "#4b5565" }, originalTitle) : null,
      h("div", { display: "flex", flexDirection: "column", marginTop: 26, padding: "20px 24px", borderRadius: 22, backgroundColor: "#f3f5f8" }, [
        h("div", { display: "flex", fontSize: 27, fontWeight: 700, color: INK }, clamp(p.source, 36)),
        h("div", { display: "flex", marginTop: 8, fontSize: 22, color: MUTED }, `${p.date} · ${clamp(p.kicker, 20)}`),
      ]),
      h("div", { display: "flex", flexDirection: "column", marginTop: 24, padding: "24px 26px 26px", borderRadius: 24, backgroundColor: "#edf4ff" }, [
        h("div", { display: "flex", fontSize: 24, fontWeight: 700, color: BLUE }, "中文导读"),
        h("div", { display: "flex", marginTop: 12, fontSize: 29, lineHeight: 1.58, color: "#293442" }, summary),
      ]),
      h("div", { display: "flex", flex: 1 }),
      h("div", { display: "flex", alignItems: "center", borderTop: "1px solid #e6e9ee", paddingTop: 28 }, [
        h("img", { width: 166, height: 166 }, undefined, { src: qr, width: 166, height: 166 }),
        h("div", { display: "flex", flexDirection: "column", marginLeft: 34, flex: 1 }, [
          h("div", { display: "flex", fontSize: 31, fontWeight: 700, color: INK }, "扫码阅读新闻"),
          h("div", { display: "flex", marginTop: 10, fontSize: 24, lineHeight: 1.48, color: MUTED }, "查看详情、证据卡与原文入口"),
          h("div", { display: "flex", marginTop: 16, fontSize: 22, color: ACCENT }, SITE_HOST),
        ]),
      ]),
      h("div", { display: "flex", flexDirection: "column", marginTop: 24, paddingTop: 20, borderTop: "1px solid #eef0f3" }, [
        h("div", { display: "flex", fontSize: 20, color: "#8a94a3" }, "内容由系统整理，摘要不替代原文、指南或临床判断。"),
        h("div", { display: "flex", marginTop: 8, fontSize: 22, fontWeight: 700, color: "#8a6118" }, `${SITE.name} · ${SITE.tagline}`),
      ]),
    ].filter(Boolean)),
  );
}

export function posterEtag(p: Poster): string {
  return createHash("sha256").update(POSTER_TEMPLATE_VERSION).update(FALLBACK_FONTS.join()).update(JSON.stringify(p)).digest("hex").slice(0, 24);
}

/** PNG bytes for a poster, from the disk cache when this exact poster was rendered before. */
export async function renderPoster(p: Poster): Promise<{ png: Buffer; etag: string }> {
  const etag = posterEtag(p);
  return { png: await renderPng(`poster-${etag}`, { width: WIDTH, height: HEIGHT }, () => tree(p)), etag };
}
