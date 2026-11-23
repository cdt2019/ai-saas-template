import { siteConfig } from "@/config/site";

const system = "matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'";
const fallback = siteConfig.defaultTheme === "system" ? system : `'${siteConfig.defaultTheme}'`;

/**
 * 首屏前执行：读取本地偏好（dark / light / system），没有就用 siteConfig.defaultTheme，避免深浅色闪烁。
 * 设置页可以选「跟随系统」，存的是 system，每次打开按设备当前的深浅色来
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='system'){t=${system}}else if(t!=='dark'&&t!=='light'){t=${fallback}}document.documentElement.dataset.theme=t}catch(e){}})()`;

/** 首屏前恢复应用侧栏的收缩状态（AppShell 里切换，存在 localStorage.sidebar） */
export const sidebarInitScript = `(function(){try{if(localStorage.getItem('sidebar')==='collapsed')document.documentElement.dataset.sidebar='collapsed'}catch(e){}})()`;
