import type { Classification, ExperienceObject } from "./experience.types.ts";
export const experienceCategories = [
  ["fupan", "复盘"],
  ["zhenghe", "整合"],
  ["renzhi", "认知"],
  ["xiezuo", "写作"],
  ["biaoda", "表达"],
  ["yingyu", "英语"],
  ["siwei", "思维"],
  ["gaorenzhi", "高阶认知"],
].map(
  ([id, title]): Classification => ({
    id,
    title,
    revision: 1,
    basis: "grow-category-v1",
  }),
);
const types = [
  ["judgment", "判断偏差", "高估或低估某事物的难度/重要性"],
  ["omission", "步骤遗漏", "执行过程中遗漏关键步骤"],
  ["concept", "概念混淆", "对某个概念的理解有偏差"],
  ["attention", "注意力分散", "执行时注意力不集中导致错误"],
  ["timing", "时间估算错误", "低估或高估所需时间"],
  ["communication", "沟通误解", "与他人沟通时产生误解"],
  ["confidence", "过度自信", "认为自己掌握了但实际没有"],
  ["other", "其他", "不属于以上类别的错误"],
];
export const defaultErrorTypes: ExperienceObject[] = types.map(
  ([id, name, description]) => ({
    id: "errtype-default-" + id,
    kind: "error_type",
    revision: 0,
    archived: false,
    classification: null,
    type_revision: null,
    data: { name, description },
    created_at: null,
    updated_at: null,
  }),
);
