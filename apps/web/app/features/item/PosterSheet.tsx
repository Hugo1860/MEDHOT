// Mobile share poster: a dark immersive preview with the useful actions around the generated image.
// Web pages cannot target WeChat Moments directly, so that action explains the honest save-then-post flow.
import { useEffect, useState, type ReactNode } from "react";
import type { FeedItemSummary } from "@aihot/contracts/site";
import { SITE } from "@aihot/site";
import { Sheet } from "../../components/ui/Sheet";
import { IconBookmark, IconClose, IconCopy, IconDownload, IconImage, IconShare } from "../../components/icons";
import { copyText } from "../../lib/clipboard";
import { useStar } from "../feed/parts";

type ShareItem = Pick<FeedItemSummary, "id" | "title" | "summary" | "source" | "publishedAt" | "score" | "selected">;

function ShareAction({ label, icon, tone, onClick, href, download, pressed }: {
  label: string;
  icon: ReactNode;
  tone: string;
  onClick?: () => void;
  href?: string;
  download?: string;
  pressed?: boolean;
}) {
  const content = (
    <>
      <span className={`grid size-12 place-items-center rounded-control text-white shadow-[0_5px_16px_rgba(0,0,0,0.18)] ${tone}`}>{icon}</span>
      <span className="mt-2 min-h-[28px] text-center text-[10.5px] leading-[1.3] text-white/90">{label}</span>
    </>
  );
  const className = "flex min-w-0 flex-col items-center rounded-control px-0.5 py-1 active:bg-white/10";
  return href ? (
    <a href={href} download={download} onClick={onClick} className={className}>{content}</a>
  ) : (
    <button type="button" onClick={onClick} aria-pressed={pressed} className={className}>{content}</button>
  );
}

export default function PosterSheet({ item, open, onClose }: { item: ShareItem; open: boolean; onClose: () => void }) {
  const { id, title } = item;
  const src = `/og/posters/${id}.png`;
  const downloadSrc = `${src}?download=1`;
  const filename = `${SITE.mcpPrefix}-${id}.png`;
  const url = `${location.origin}/items/${id}`;
  // The server cannot know the browser's user agent. Detect it after hydration so React does not
  // preserve the server's ordinary download link in WeChat or on an iPhone.
  const [client, setClient] = useState({ inWechat: false, appleMobile: false });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveGuide, setSaveGuide] = useState(false);
  const [openOriginal, setOpenOriginal] = useState(false);
  const star = useStar(item);

  useEffect(() => {
    const inWechat = /MicroMessenger/i.test(navigator.userAgent);
    const appleMobile = /iPad|iPhone|iPod/i.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setClient({ inWechat, appleMobile });
  }, []);

  useEffect(() => {
    if (!open) return;
    setNotice(null);
    setSaveGuide(false);
    setOpenOriginal(false);
  }, [open]);

  async function shareFriend() {
    if (/MicroMessenger/i.test(navigator.userAgent)) {
      setNotice("请点击右上角 ···，选择“发送给朋友”");
      return;
    }
    try {
      if (navigator.share) {
        // A URL is accepted by more WeChat share targets than a PNG file. The target application,
        // recipient picker and final delivery remain controlled by the operating system.
        await navigator.share({ title, text: `${SITE.name}：${title}`, url });
        setNotice("已调起系统分享，请在微信中选择好友");
        return;
      }
      await copyText(`${title}\n${url}`);
      setNotice("链接已复制，可发送给朋友");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice("暂时无法调起分享，已保留海报和复制链接入口");
    }
  }

  async function copyLink() {
    try {
      await copyText(url);
      setNotice("链接已复制");
    } catch {
      setNotice("复制失败，请长按海报保存");
    }
  }

  function guideLongPressSave() {
    setSaveGuide(true);
    setOpenOriginal(true);
    setNotice("请长按上方海报，选择“保存图片”");
  }

  async function saveOnAppleMobile() {
    setSaveGuide(false);
    setOpenOriginal(false);
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(String(response.status));
      const file = new File([await response.blob()], filename, { type: "image/png" });
      if (!navigator.canShare?.({ files: [file] })) throw new Error("file sharing unavailable");
      await navigator.share({ files: [file], title });
      setNotice("请在系统菜单中选择“存储图像”");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setOpenOriginal(true);
      setNotice("当前浏览器不能直接存入相册，请打开原图后长按保存");
    }
  }

  const toggleStar = () => {
    const adding = !star.on;
    star.toggle();
    setNotice(adding ? "已收藏到本机" : "已取消收藏");
  };

  return (
    <Sheet open={open} onClose={onClose} label="分享海报" immersive>
      <div className="flex min-h-0 flex-col items-center px-1">
        <div className={`relative aspect-[3/4] w-full max-w-[min(360px,calc((100dvh-230px)*0.75))] shrink-0 overflow-hidden rounded-mark border bg-white shadow-[0_14px_46px_rgba(0,0,0,0.36)] ${saveGuide ? "border-white ring-4 ring-white/75" : "border-white/25"}`}>
          {!loaded && !failed && <div className="absolute inset-0 animate-pulse bg-[linear-gradient(110deg,#eef1f4_30%,#ffffff_50%,#eef1f4_70%)] bg-[length:200%_100%]" />}
          {failed ? (
            <p className="absolute inset-0 grid place-items-center px-6 text-center text-[13px] text-ink-3">海报生成失败，请稍后再试。</p>
          ) : (
            <img
              src={src}
              alt={`${title} · 分享海报`}
              className={`size-full object-contain transition-[opacity,transform] duration-[250ms] ${loaded ? "scale-100 opacity-100" : "scale-[0.985] opacity-0"}`}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          )}
          {saveGuide && <div className="pointer-events-none absolute inset-x-4 top-4 rounded-full bg-black/75 px-4 py-2 text-center text-[13px] font-medium text-white">长按海报，选择“保存图片”</div>}
        </div>

        <div className="mt-4 grid w-full max-w-[410px] grid-cols-5 gap-1" aria-label="分享方式">
          <ShareAction label="发给朋友" icon={<IconShare size={23} strokeWidth={2.1} />} tone="bg-[#20b35a]" onClick={() => void shareFriend()} />
          <ShareAction label="朋友圈" icon={<IconImage size={23} strokeWidth={2.1} />} tone="bg-[conic-gradient(#f05a5a,#f2bd3e,#43b96b,#3d83d7,#9a5ac8,#f05a5a)]" onClick={() => setNotice("请长按海报保存，再从朋友圈选择图片发布")} />
          <ShareAction label={star.on ? "已收藏" : "收藏"} icon={<IconBookmark size={23} strokeWidth={2.1} filled={star.on} />} tone="bg-[#7759d7]" onClick={toggleStar} pressed={star.on} />
          {client.inWechat ? (
            <ShareAction label="长按保存" icon={<IconDownload size={24} strokeWidth={2.1} />} tone="bg-[#2688d9]" onClick={guideLongPressSave} />
          ) : client.appleMobile ? (
            <ShareAction label="保存图片" icon={<IconDownload size={24} strokeWidth={2.1} />} tone="bg-[#2688d9]" onClick={() => void saveOnAppleMobile()} />
          ) : (
            <ShareAction label="保存图片" icon={<IconDownload size={24} strokeWidth={2.1} />} tone="bg-[#2688d9]" href={downloadSrc} download={filename} onClick={() => setNotice("图片下载已开始")} />
          )}
          <ShareAction label="复制链接" icon={<IconCopy size={22} strokeWidth={2.1} />} tone="bg-[#257a80]" onClick={() => void copyLink()} />
        </div>

        <div role="status" aria-live="polite" className="mt-1.5 min-h-5 px-4 text-center text-[11px] leading-5 text-white/75">
          {notice ?? "长按海报也可以保存或发送"}
          {openOriginal && <a href={src} target="_blank" rel="noreferrer" className="ml-1 font-medium text-white underline underline-offset-2">打开原图</a>}
        </div>
        <button type="button" aria-label="关闭" onClick={onClose} className="mt-1 grid size-11 shrink-0 place-items-center rounded-full bg-white/12 text-white active:bg-white/20">
          <IconClose size={25} strokeWidth={2.1} />
        </button>
      </div>
    </Sheet>
  );
}
