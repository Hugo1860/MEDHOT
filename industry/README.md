# 行业包

这个行业的知识都在这里：分类、主题、信源、精选标准和门槛。换一个行业，主要就是改这个文件夹和 [`site/`](../site/)（站名、文案、品牌和页面），步骤见 [把它改成你的行业](../docs/customize.md)。

| 文件 | 内容 |
|---|---|
| `taxonomy.ts` | 分类、标签、公司与机构、防止模型写错公司的词表，这个行业最受关注的那类发布（`RELEASE`） |
| `topics.json` | 主题目录（`/topics`），站点启动时读取 |
| `sources.json` | 首次启动时导入的示范信源 |
| `prompts/` | 每一步的提示词：预筛、评分、写作、结构化、归组、事件综述、周报月报、翻译 |
| `selection.ts` | 入选门槛 |
| `gold.example.jsonl` | 精选评测样本的格式示例 |
| `relation-gold.example.jsonl` | 事件关系评测样本的格式示例 |
| `story-digest-eval.example.jsonl` | 事件综述评测案例的格式示例 |

## 医学信源接入说明

`sources.json` 已配置第一批可直接订阅的官方医学研究、药械安全、公共卫生、质量安全和医疗 AI 信源。所有来源均保持 `site_fulltext: false` 与 `syndicate_fulltext: false`，网站只展示摘要和原文链接。

以下来源尚未写入自动采集配置：

- PubMed：需要先由使用者确定科室、疾病、研究类型等检索式，再在 PubMed 生成对应 RSS；不使用无边界的全库新文献流。
- The Lancet、Cochrane、IHI、Annals of Internal Medicine、BMC Medical Education、Academic Medicine、JAMIA、NEJM AI：当前清单给出的官方入口主要是邮件提醒、需登录提醒或没有稳定公开 RSS；待取得可持续的官方机器入口后再接入。
- NICE Syndication API：需要申请并确认许可，不在未授权状态下调用。
- WHO、AHA/ASA、ESMO、IDSA、KDIGO、ADA、ATS、SHEA：需要按医院重点科室确定优先级，并逐个验证列表结构或官方订阅入口。
- AHRQ PSNet：作为截至 2025-03-24 的经典病例与教学资料库使用，不作为持续更新信源。
- Crossref Retraction Watch、Europe PMC、ClinicalTrials.gov：属于后续结构化接口工作；撤稿、更正和试验注册不能与普通新闻混为一类。

JAMA 的官方 RSS 在部分网络环境可能返回 403。部署后应在后台“信源 → 预览抓取”复验；若目标服务器同样被拒绝，应暂停该信源，不能用抓网页或绕过访问控制替代。
