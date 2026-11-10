// 医护知新的医学分类、主题标签和机构名录。类别 key 会进入公开网址，上线后不要改。

export const CATEGORIES = [
  { key: "research", tagColor: "violet", label: "研究前沿", section: "研究与证据", guide: "原始临床研究、观察性研究、诊断或预后研究、系统评价、Meta 分析及重要转化研究。试验注册不是研究结果；仅有方案时不能写成已经证实。" },
  { key: "guideline", tagColor: "indigo", label: "指南共识", section: "指南与实践", guide: "正式指南、共识、质量标准和明确的版本修订。区分草案、征求意见稿、正式版、局部更新与被替换版本。" },
  { key: "safety", tagColor: "red", label: "药械安全", section: "安全与监管", guide: "药品、疫苗和医疗器械的安全警示、召回、风险沟通、监管决定及重要更正，必须保留适用国家或地区。" },
  { key: "public-health", tagColor: "orange", label: "公卫院感", section: "公卫与院感", guide: "疫情监测、风险评估、感染预防控制、抗菌药物管理和公共卫生建议。普通媒体疫情报道优先归医学新闻。" },
  { key: "nursing-quality", tagColor: "turquoise", label: "护理质控", section: "护理与质量", guide: "循证护理、患者安全、护理管理、照护模式、质量改进、诊疗流程和团队协作研究或实践。" },
  { key: "medical-education", tagColor: "green", label: "医学教育", section: "教学与学习", guide: "临床带教、教师发展、能力评价、课程设计、模拟教学、继续教育和医学教育管理。" },
  { key: "medical-ai", tagColor: "blue", label: "医疗 AI", section: "数字医学", guide: "医疗 AI、临床信息系统、数字医学和决策支持的开发、验证、实施与评价；仅宣传功能而无临床或流程证据时仍归此类但应低评分。" },
  { key: "medical-news", tagColor: "purple", label: "医学新闻", section: "医学动态", guide: "对论文、监管、产业和临床议题的新闻或解读。尽可能关联原始研究、指南或监管文件，不把报道本身当作更高等级证据。", commentary: true },
] as const satisfies ReadonlyArray<{ key: string; tagColor: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

export const RELEASE: { category: string; tag: string; unit: string } | null = null;

export const PLAIN_TERMS: readonly string[] = [
  "doi", "pmid", "rct", "ci", "hr", "or", "rr", "meta", "who", "fda", "ema", "cdc", "ecdc", "nejm", "jama", "bmj",
];

export const ITEM_TYPES = [
  "clinical_research",
  "systematic_review",
  "guideline_consensus",
  "safety_alert",
  "public_health_update",
  "quality_improvement",
  "medical_education",
  "medical_ai",
  "medical_news",
] as const;

export const CATEGORY_TAGS = [
  "临床研究", "系统评价", "指南/共识", "药械安全", "公卫/院感", "护理/质控", "医学教育", "医疗AI", "医学新闻", "更正/撤稿", "其他",
] as const;

export const TOPIC_TAGS = [
  "心血管", "神经", "肿瘤", "感染", "呼吸", "重症", "内分泌", "肾脏", "消化", "儿科", "妇产", "精神心理",
  "外科", "急诊", "全科", "药学", "护理", "患者安全", "抗菌药物管理", "医学教育", "数字医学", "临床决策支持",
] as const;

export const ENTITY_TAGS = [
  "PubMed", "NEJM", "JAMA", "The Lancet", "The BMJ", "WHO", "FDA", "EMA", "CDC", "ECDC", "NICE", "Cochrane",
] as const;

export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  论文: "临床研究", 研究: "临床研究", 试验: "临床研究", "随机对照试验": "临床研究",
  meta: "系统评价", "Meta分析": "系统评价", 荟萃分析: "系统评价", 循证综述: "系统评价",
  指南: "指南/共识", 共识: "指南/共识", 标准: "指南/共识",
  药品安全: "药械安全", 器械安全: "药械安全", 召回: "药械安全",
  公共卫生: "公卫/院感", 院感: "公卫/院感", 感控: "公卫/院感",
  护理: "护理/质控", 质控: "护理/质控", 质量改进: "护理/质控", 患者安全: "护理/质控",
  教学: "医学教育", 带教: "医学教育", 医疗人工智能: "医疗AI", 数字医疗: "医疗AI",
  撤稿: "更正/撤稿", 更正: "更正/撤稿", 新闻: "医学新闻", 解读: "医学新闻",
};

export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; orgNames?: string[]; otherNames?: string[] }> = {
  pubmed: { name: "PubMed", displayTag: "PubMed", aliases: ["PubMed", "NLM", "MEDLINE"], orgNames: ["National Library of Medicine", "NLM"] },
  nejm: { name: "NEJM", displayTag: "NEJM", aliases: ["NEJM", "New England Journal of Medicine"], orgNames: ["NEJM Group"] },
  jama: { name: "JAMA Network", displayTag: "JAMA", aliases: ["JAMA", "JAMA Network", "JAMA Network Open"], orgNames: ["American Medical Association", "JAMA Network"] },
  lancet: { name: "The Lancet", displayTag: "The Lancet", aliases: ["The Lancet", "Lancet"] },
  bmj: { name: "The BMJ", displayTag: "The BMJ", aliases: ["The BMJ", "BMJ", "BMJ Quality & Safety"], orgNames: ["BMJ Group"] },
  nature: { name: "Nature Portfolio", displayTag: "Nature", aliases: ["Nature Medicine", "npj Digital Medicine", "Nature Portfolio"], orgNames: ["Springer Nature", "Nature Portfolio"] },
  who: { name: "WHO", displayTag: "WHO", aliases: ["WHO", "World Health Organization", "世界卫生组织"], orgNames: ["WHO"] },
  fda: { name: "FDA", displayTag: "FDA", aliases: ["FDA", "U.S. Food and Drug Administration", "MedWatch"], orgNames: ["FDA"] },
  ema: { name: "EMA", displayTag: "EMA", aliases: ["EMA", "European Medicines Agency"], orgNames: ["EMA"] },
  cdc: { name: "CDC", displayTag: "CDC", aliases: ["CDC", "MMWR", "Centers for Disease Control and Prevention"], orgNames: ["CDC"] },
  ecdc: { name: "ECDC", displayTag: "ECDC", aliases: ["ECDC", "European Centre for Disease Prevention and Control"], orgNames: ["ECDC"] },
  mhra: { name: "MHRA", displayTag: "MHRA", aliases: ["MHRA", "Medicines and Healthcare products Regulatory Agency"], orgNames: ["MHRA"] },
  cidrap: { name: "CIDRAP", displayTag: "CIDRAP", aliases: ["CIDRAP", "Center for Infectious Disease Research and Policy"], orgNames: ["CIDRAP"] },
  nice: { name: "NICE", displayTag: "NICE", aliases: ["NICE", "National Institute for Health and Care Excellence"], orgNames: ["NICE"] },
  cochrane: { name: "Cochrane", displayTag: "Cochrane", aliases: ["Cochrane", "Cochrane Library", "Cochrane Review"], orgNames: ["Cochrane"] },
  ndcpa: { name: "国家疾病预防控制局", displayTag: "国家疾控局", aliases: ["国家疾病预防控制局", "国家疾控局", "NDCPA"], orgNames: ["国家疾病预防控制局"] },
  "china-cdc": { name: "中国疾病预防控制中心", displayTag: "中国疾控中心", aliases: ["中国疾病预防控制中心", "中国疾控中心", "China CDC"], orgNames: ["中国疾病预防控制中心"] },
  cde: { name: "国家药品监督管理局药品审评中心", displayTag: "国家药审中心", aliases: ["国家药品监督管理局药品审评中心", "国家药监局药审中心", "药品审评中心", "CDE"], orgNames: ["国家药品监督管理局药品审评中心"] },
  nhc: { name: "国家卫生健康委员会", displayTag: "国家卫生健康委", aliases: ["国家卫生健康委员会", "国家卫生健康委", "国家卫健委", "NHC"], orgNames: ["国家卫生健康委员会"] },
  nmpa: { name: "国家药品监督管理局", displayTag: "国家药监局", aliases: ["国家药品监督管理局", "国家药监局", "NMPA"], orgNames: ["国家药品监督管理局"] },
  cmde: { name: "国家药品监督管理局医疗器械技术审评中心", displayTag: "器审中心", aliases: ["国家药品监督管理局医疗器械技术审评中心", "医疗器械技术审评中心", "器审中心", "CMDE"], orgNames: ["国家药品监督管理局医疗器械技术审评中心"] },
  chictr: { name: "中国临床试验注册中心", displayTag: "ChiCTR", aliases: ["中国临床试验注册中心", "ChiCTR", "Chinese Clinical Trial Registry"], orgNames: ["中国临床试验注册中心"] },
};

export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "nejm", name: "NEJM", patterns: [/\bNEJM\b|New England Journal of Medicine/i] },
  { id: "jama", name: "JAMA", patterns: [/\bJAMA\b|JAMA Network/i] },
  { id: "lancet", name: "The Lancet", patterns: [/\bThe Lancet\b|\bLancet\b/i] },
  { id: "bmj", name: "The BMJ", patterns: [/\bBMJ\b|British Medical Journal/i] },
  { id: "who", name: "WHO", patterns: [/\bWHO\b|World Health Organization|世界卫生组织/i] },
  { id: "fda", name: "FDA", patterns: [/\bFDA\b|Food and Drug Administration|MedWatch/i] },
  { id: "ema", name: "EMA", patterns: [/\bEMA\b|European Medicines Agency/i] },
  { id: "cdc", name: "CDC", patterns: [/\bCDC\b|\bMMWR\b|Centers for Disease Control/i] },
  { id: "ecdc", name: "ECDC", patterns: [/\bECDC\b|European Centre for Disease Prevention/i] },
  { id: "mhra", name: "MHRA", patterns: [/\bMHRA\b|Medicines and Healthcare products Regulatory Agency/i] },
  { id: "cidrap", name: "CIDRAP", patterns: [/\bCIDRAP\b|Center for Infectious Disease Research and Policy/i] },
  { id: "ndcpa", name: "国家疾控局", patterns: [/国家疾病预防控制局|国家疾控局|\bNDCPA\b/i] },
  { id: "china-cdc", name: "中国疾控中心", patterns: [/中国疾病预防控制中心|中国疾控中心|\bChina CDC\b/i] },
  { id: "cde", name: "国家药审中心", patterns: [/国家药品监督管理局药品审评中心|国家药监局药审中心|药品审评中心|\bCDE\b/i] },
  { id: "nhc", name: "国家卫生健康委", patterns: [/国家卫生健康委员会|国家卫生健康委|国家卫健委|\bNHC\b/i] },
  { id: "nmpa", name: "国家药监局", patterns: [/国家药品监督管理局|国家药监局|\bNMPA\b/i] },
  { id: "cmde", name: "器审中心", patterns: [/国家药品监督管理局医疗器械技术审评中心|医疗器械技术审评中心|器审中心|\bCMDE\b/i] },
  { id: "chictr", name: "中国临床试验注册中心", patterns: [/中国临床试验注册中心|\bChiCTR\b|Chinese Clinical Trial Registry/i] },
];

export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "nejm", domains: ["nejm.org"] },
  { entityId: "jama", domains: ["jamanetwork.com"] },
  { entityId: "lancet", domains: ["thelancet.com"] },
  { entityId: "bmj", domains: ["bmj.com"] },
  { entityId: "nature", domains: ["nature.com"] },
  { entityId: "who", domains: ["who.int"] },
  { entityId: "fda", domains: ["fda.gov"] },
  { entityId: "ema", domains: ["ema.europa.eu"] },
  { entityId: "cdc", domains: ["cdc.gov"] },
  { entityId: "ecdc", domains: ["ecdc.europa.eu"] },
  { entityId: "mhra", domains: ["gov.uk"] },
  { entityId: "cidrap", domains: ["cidrap.umn.edu"] },
  { entityId: "nice", domains: ["nice.org.uk"] },
  { entityId: "cochrane", domains: ["cochranelibrary.com", "cochrane.org"] },
  { entityId: "ndcpa", domains: ["ndcpa.gov.cn"] },
  { entityId: "china-cdc", domains: ["chinacdc.cn"] },
  { entityId: "cde", domains: ["cde.org.cn"] },
  { entityId: "nhc", domains: ["nhc.gov.cn"] },
  { entityId: "nmpa", domains: ["nmpa.gov.cn"] },
  { entityId: "cmde", domains: ["cmde.org.cn"] },
  { entityId: "chictr", domains: ["chictr.org.cn"] },
];

export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [];
