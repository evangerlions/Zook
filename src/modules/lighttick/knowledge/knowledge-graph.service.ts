import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { KnowledgeEntry } from "./knowledge.types.ts";

/**
 * 知识图谱可视化 — 关系检测。
 * 检测知识节点之间的关系：同源关系、关键词共现、分类关系。
 */

export interface KnowledgeLink {
  source_id: string;
  target_id: string;
  link_type: "same_source" | "keyword" | "category";
  weight: number;
}

export interface KnowledgeGraph {
  nodes: { id: string; title: string; kind: string; tags: string[] }[];
  links: KnowledgeLink[];
}

function extractKeywords(text: string): Set<string> {
  if (!text) return new Set();

  // 提取中文（2-4 字词组）
  const chineseWords = text.match(/[一-龥]{2,4}/g) ?? [];

  // 提取英文单词（3 个字符以上）
  const englishWords = (text.match(/[a-zA-Z]{3,}/g) ?? []).map(w => w.toLowerCase());

  const keywords = new Set([...chineseWords, ...englishWords]);

  // 过滤常见词
  const stopWords = new Set([
    '的', '是', '在', '和', '与', '或', '有', '也', '都', '就', '不', '了', '这', '那',
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'how',
  ]);
  for (const word of keywords) {
    if (stopWords.has(word)) keywords.delete(word);
  }
  return keywords;
}

export class LightTickKnowledgeGraphService {
  constructor(private readonly repository: LightTickRepository) {}

  async getGraph(owner: LightTickOwner, depth: number = 3): Promise<KnowledgeGraph> {
    const entries = await this.repository.knowledge.list(owner);
    if (entries.length === 0) {
      return { nodes: [], links: [] };
    }

    // Limit nodes for performance
    const limitedEntries = entries.slice(0, 200);

    const nodes = limitedEntries.map(e => ({
      id: e.id,
      title: e.title,
      kind: e.kind,
      tags: e.tags,
    }));

    const links: KnowledgeLink[] = [];

    // 1. 同源关系：来自同一个 source 的节点
    const nodesBySource = new Map<string, string[]>();
    for (const e of limitedEntries) {
      for (const source of e.sources) {
        const key = `${source.kind}:${source.id}`;
        const list = nodesBySource.get(key) ?? [];
        list.push(e.id);
        nodesBySource.set(key, list);
      }
    }
    for (const [, nodeIds] of nodesBySource) {
      if (nodeIds.length > 1) {
        for (let i = 0; i < nodeIds.length; i++) {
          for (let j = i + 1; j < nodeIds.length; j++) {
            links.push({ source_id: nodeIds[i], target_id: nodeIds[j], link_type: "same_source", weight: 3 });
          }
        }
      }
    }

    // 2. 关键词共现：tags 或 title 中包含相同关键词
    const nodeKeywords = new Map<string, Set<string>>();
    for (const e of limitedEntries.slice(0, 100)) {
      const keywords = new Set<string>(e.tags);
      for (const kw of extractKeywords(e.title)) {
        keywords.add(kw);
      }
      if (keywords.size > 0) {
        nodeKeywords.set(e.id, keywords);
      }
    }
    const nodeList = Array.from(nodeKeywords.entries());
    for (let i = 0; i < nodeList.length; i++) {
      for (let j = i + 1; j < nodeList.length; j++) {
        const [id1, kw1] = nodeList[i];
        const [id2, kw2] = nodeList[j];
        let common = 0;
        for (const kw of kw1) {
          if (kw2.has(kw)) common++;
        }
        if (common >= 2) {
          const weight = Math.min(common, 5);
          links.push({ source_id: id1, target_id: id2, link_type: "keyword", weight });
        }
      }
    }

    // 3. 分类关系：同一 kind 的节点（弱关联）
    const nodesByKind = new Map<string, string[]>();
    for (const e of limitedEntries) {
      const list = nodesByKind.get(e.kind) ?? [];
      list.push(e.id);
      nodesByKind.set(e.kind, list);
    }
    for (const [, nodeIds] of nodesByKind) {
      if (nodeIds.length > 1) {
        let count = 0;
        for (let i = 0; i < nodeIds.length && count < 20; i++) {
          for (let j = i + 1; j < nodeIds.length && count < 20; j++) {
            links.push({ source_id: nodeIds[i], target_id: nodeIds[j], link_type: "category", weight: 1 });
            count++;
          }
        }
      }
    }

    return { nodes, links };
  }
}
