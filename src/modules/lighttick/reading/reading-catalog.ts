// Frozen public catalogue only; no personal learning projects or current provider verification.
export const READING_CATALOG_REVISION="2026-11-12.1";
export const READING_TOPICS={
  "认知": [
    "cognition",
    "thinking",
    "reason",
    "evidence",
    "decision",
    "思考",
    "认知",
    "判断",
    "学习"
  ],
  "科技": [
    "technolog",
    "science",
    "artificial intelligence",
    "robot",
    "space",
    "physics",
    "科技",
    "科学",
    "人工智能",
    "航天",
    "物理",
    "医疗技术"
  ],
  "经济学": [
    "econom",
    "market",
    "money",
    "growth",
    "inequality",
    "经济",
    "金融",
    "市场",
    "贫富",
    "增长"
  ],
  "社会学": [
    "social",
    "societ",
    "culture",
    "institution",
    "community",
    "社会",
    "文化",
    "制度",
    "人口"
  ],
  "心理": [
    "psycholog",
    "emotion",
    "mind",
    "mental",
    "memory",
    "心理",
    "情绪",
    "记忆",
    "幸福"
  ],
  "成长": [
    "learn",
    "work",
    "career",
    "habit",
    "productiv",
    "成长",
    "职业",
    "工作",
    "习惯",
    "教育",
    "学习"
  ]
} as const;
export const READING_DEFAULT_SOURCES=[
  {
    "id": "source-catalog-aeon",
    "catalog_id": "aeon",
    "legacy_id": "aeon",
    "title": "Aeon",
    "url": "https://aeon.co/feed.rss",
    "format": "rss",
    "language": "en",
    "topics": [
      "认知",
      "社会学",
      "心理"
    ],
    "domains": [
      "aeon.co"
    ],
    "custom": false
  },
  {
    "id": "source-catalog-behavioral",
    "catalog_id": "behavioral",
    "legacy_id": "behavioral",
    "title": "Behavioral Scientist",
    "url": "https://behavioralscientist.org/feed/",
    "format": "rss",
    "language": "en",
    "topics": [
      "认知",
      "心理",
      "社会学"
    ],
    "domains": [
      "behavioralscientist.org"
    ],
    "custom": false
  },
  {
    "id": "source-catalog-ftchinese",
    "catalog_id": "ftchinese",
    "legacy_id": "ftchinese",
    "title": "FT中文网",
    "url": "https://www.ftchinese.com/rss/feed",
    "format": "rss",
    "language": "zh",
    "topics": [
      "经济学",
      "社会学"
    ],
    "domains": [
      "www.ftchinese.com",
      "ftchinese.com"
    ],
    "custom": false
  },
  {
    "id": "source-catalog-ruanyifeng",
    "catalog_id": "ruanyifeng",
    "legacy_id": "ruanyifeng",
    "title": "阮一峰的网络日志",
    "url": "https://www.ruanyifeng.com/blog/atom.xml",
    "format": "atom",
    "language": "zh",
    "topics": [
      "科技",
      "成长",
      "社会学"
    ],
    "domains": [
      "www.ruanyifeng.com",
      "ruanyifeng.com"
    ],
    "custom": false
  },
  {
    "id": "source-catalog-owid",
    "catalog_id": "owid",
    "legacy_id": "owid",
    "title": "Our World in Data",
    "url": "https://ourworldindata.org/atom.xml",
    "format": "atom",
    "language": "en",
    "topics": [
      "经济学",
      "社会学",
      "认知"
    ],
    "domains": [
      "ourworldindata.org"
    ],
    "custom": false
  },
  {
    "id": "source-catalog-36kr",
    "catalog_id": "36kr",
    "legacy_id": "36kr",
    "title": "36氪",
    "url": "https://36kr.com/feed",
    "format": "rss",
    "language": "zh",
    "topics": [
      "科技",
      "成长",
      "经济学"
    ],
    "domains": [
      "36kr.com"
    ],
    "custom": false
  },
  {
    "id": "source-catalog-sspai",
    "catalog_id": "sspai",
    "legacy_id": "sspai",
    "title": "少数派",
    "url": "https://sspai.com/feed",
    "format": "rss",
    "language": "zh",
    "topics": [
      "科技",
      "成长",
      "认知"
    ],
    "domains": [
      "sspai.com"
    ],
    "custom": false
  },
  {
    "id": "source-catalog-hbr",
    "catalog_id": "hbr",
    "legacy_id": "hbr",
    "title": "Harvard Business Review",
    "url": "https://hbr.org/feed",
    "format": "rss",
    "language": "en",
    "topics": [
      "成长",
      "认知",
      "心理"
    ],
    "domains": [
      "hbr.org"
    ],
    "custom": false
  },
  {
    "id": "source-catalog-psychology_today",
    "catalog_id": "psychology_today",
    "legacy_id": "psychology_today",
    "title": "Psychology Today",
    "url": "https://www.psychologytoday.com/us/blog/rss",
    "format": "rss",
    "language": "en",
    "topics": [
      "心理",
      "认知"
    ],
    "domains": [
      "psychologytoday.com"
    ],
    "custom": false
  },
  {
    "id": "source-catalog-waitbutwhy",
    "catalog_id": "waitbutwhy",
    "legacy_id": "waitbutwhy",
    "title": "Wait But Why",
    "url": "https://waitbutwhy.com/feed",
    "format": "rss",
    "language": "en",
    "topics": [
      "认知",
      "成长",
      "心理"
    ],
    "domains": [
      "waitbutwhy.com"
    ],
    "custom": false
  }
] as const;
export const READING_CLASSICS=[
  {
    "title": "The short history of global living conditions and why it matters that we know it",
    "translated_title": "用长期数据理解全球生活条件的变化",
    "source_url": "https://ourworldindata.org/a-history-of-global-living-conditions",
    "author": "Max Roser",
    "publisher": "Our World in Data",
    "language": "en",
    "published_at": null,
    "published_date": "2016-12-14",
    "topics": [
      "经济学",
      "社会学",
      "认知"
    ],
    "description": "文章用贫困、教育、健康等长期指标讨论生活条件的变化，提醒读者区分即时新闻与长期趋势。阅读时应检查指标定义、历史估计的不确定性，以及总体改善是否掩盖群体差异。",
    "access": "编辑核验原始页面；原创中文摘要，页面2024年有修订",
    "category": "classic"
  },
  {
    "title": "Maps of Bounded Rationality: A Perspective on Intuitive Judgment and Choice",
    "translated_title": "有限理性：直觉判断与选择",
    "source_url": "https://www.nobelprize.org/uploads/2018/06/kahnemann-lecture.pdf",
    "author": "Daniel Kahneman",
    "publisher": "Nobel Foundation",
    "language": "en",
    "published_at": null,
    "published_date": "2002-12-08",
    "topics": [
      "认知",
      "心理",
      "经济学"
    ],
    "description": "这份诺贝尔讲座回顾判断启发式、风险选择和框架效应，讨论快速直觉与审慎思考。适合带着具体决策例子阅读；经典研究框架不等于对每个个体行为的诊断或预测。",
    "access": "核验官方讲座摘要；未逐页核验PDF",
    "category": "classic"
  },
  {
    "title": "Why do women live longer than men?",
    "translated_title": "如何用多因素解释寿命差异",
    "source_url": "https://ourworldindata.org/why-do-women-live-longer-than-men",
    "author": "Saloni Dattani / Lucas Rodés-Guirao",
    "publisher": "Our World in Data",
    "language": "en",
    "published_at": null,
    "published_date": "2023-11-27",
    "topics": [
      "社会学",
      "认知"
    ],
    "description": "文章按年龄、地区和历史变化分析平均寿命差异，展示多种因素如何共同影响结果。可练习区分总体统计与个体情况，以及描述性数据与因果解释。此阅读不用于个人医疗判断。",
    "access": "编辑核验原始页面；原创中文摘要",
    "category": "classic"
  },
  {
    "title": "科技爱好者周刊：第82期",
    "translated_title": "从职业环境与协作中理解成长",
    "source_url": "https://ruanyifeng.com/blog/2019/11/weekly-issue-82.html",
    "author": "阮一峰",
    "publisher": "阮一峰的网络日志",
    "language": "zh",
    "published_at": null,
    "published_date": "2019-11-15",
    "topics": [
      "成长"
    ],
    "description": "本期周刊包含职业成长的讨论：工作环境和协作对象可能改变一个人的学习机会。可结合自己的经历审视这个观点；文章包含个人观察与推荐链接，不代表普遍适用的因果结论。",
    "access": "核验原始页面检索摘要；非全文核验",
    "category": "classic"
  }
] as const;
