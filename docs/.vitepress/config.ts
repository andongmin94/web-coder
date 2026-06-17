import { defineConfig } from "vitepress";

const SITE_TITLE = "웹 코더";
const SITE_DESCRIPTION =
  "백준(BOJ) 제출 페이지에서 코드 실행/제출을 보조하는 Chrome 확장 프로그램";

export default defineConfig({
  lang: "ko-KR",
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,

  head: [
    ["link", { rel: "icon", type: "image/png", href: "/logo.png" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: SITE_TITLE }],
    ["meta", { property: "og:description", content: SITE_DESCRIPTION }],
    ["meta", { name: "theme-color", content: "#003E91" }],
  ],

  themeConfig: {
    logo: "/logo.svg",

    editLink: {
      pattern:
        "https://mail.google.com/mail/?view=cm&fs=1&to=andongmin94@gmail.com&su=웹%20코더%20문의&body=",
      text: "Gmail로 문의하기",
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/andongmin94/web-coder" },
    ],

    nav: [
      { text: "웹 코더 가이드", link: "/guide/", activeMatch: "^/guide/" },
      { text: "웹 코더 개발자", link: "/maintainer" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "문서 홈",
          items: [{ text: "문서 시작하기", link: "/guide/" }],
        },
        {
          text: "사용자 문서",
          items: [
            { text: "시작하기", link: "/guide/user/" },
            { text: "설치", link: "/guide/user/install" },
            { text: "사용 가이드", link: "/guide/user/usage" },
            { text: "문제 해결", link: "/guide/user/troubleshooting" },
          ],
        },

        {
          text: "개발자 문서",
          items: [
            { text: "개발자 시작하기", link: "/guide/developer/" },
            { text: "로컬 개발 및 빌드", link: "/guide/developer/setup" },
            { text: "기술 구조", link: "/guide/developer/architecture" },
          ],
        },
        {
          text: "공통 문서",
          items: [{ text: "개인정보처리방침", link: "/guide/policy" }],
        },
      ],
    },

    sidebarMenuLabel: "메뉴",
    returnToTopLabel: "위로 가기",
    darkModeSwitchLabel: "다크 모드",

    docFooter: {
      prev: "이전 페이지",
      next: "다음 페이지",
    },

    footer: {
      message: "Released under the EULA License",
      copyright: "Copyright © 2026 안동민",
    },

    outline: {
      level: [2, 3],
      label: "목차",
    },
  },
});
