import { SEARCH_SCENES } from "../search/search-types.ts";
import { webSearchTool } from "../tools/web-search-tool.ts";
import { TOOL_GUIDANCE_PLACEHOLDER, type SystemPromptSection } from "./system-prompt-section.ts";

export class WebSearchSystemSection implements SystemPromptSection {
  readonly content = "- Web search incurs a cost. Use web_search only when external information is necessary to fulfill the user's request.";
  readonly placeholder = TOOL_GUIDANCE_PLACEHOLDER;
  readonly position = 100;
  readonly scope = { ...webSearchTool.visibility, scenes: SEARCH_SCENES, requiredTool: webSearchTool.name };
}
