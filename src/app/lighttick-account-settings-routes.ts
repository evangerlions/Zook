import {handlePortfolio} from "./lighttick-portfolio-routes.ts";
import type {PortfolioService} from "../modules/lighttick/investments/portfolio/portfolio.service.ts";
import {handleStrategies} from "./lighttick-strategy-routes.ts";
import type {StrategyService} from "../modules/lighttick/investments/strategies/strategy.service.ts";
import {handleObservations} from "./lighttick-observation-routes.ts";
import type {ObservationWorkService} from "../modules/lighttick/investments/observations/observation.work-service.ts";
import {handleScreening} from "./lighttick-screening-routes.ts";
import type {ScreeningService} from "../modules/lighttick/investments/screening/screen.service.ts";
import { handleResearchAI } from "./lighttick-research-ai-routes.ts";
import type { ResearchAIService } from "../modules/lighttick/investments/research-ai/research-ai.service.ts";
import { handlePersonalModelRequest } from "./lighttick-personal-model-routes.ts";
import { handleGitHubRequest } from "./lighttick-github-routes.ts";
import type { PersonalModelService } from "../modules/lighttick/personal-model/personal-model.service.ts";
import type { GitHubService } from "../modules/lighttick/github/github.service.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
export async function handleAccountSettingsRequest(
  runtime: {
    portfolio?:PortfolioService;
    strategies?:StrategyService;
    observations?:ObservationWorkService;
    screening?:ScreeningService;
    researchAI?: ResearchAIService;
    personalModel?: PersonalModelService;
    github?: GitHubService;
  },
  owner: LightTickOwner,
  request: HttpRequest,
  authorize: () => Promise<void>,
) {
  if(/^\/api\/v1\/lighttick\/investments\/accounts\/inv-[a-zA-Z0-9_-]+\/(portfolio|valuations)(?:\/|$)/.test(request.path))return handlePortfolio(runtime,owner,request,authorize);
  if(/^\/api\/v1\/lighttick\/investments\/(strategies|backtests)(?:\/|$)/.test(request.path))return handleStrategies(runtime,owner,request,authorize);
  if(request.path==="/api/v1/lighttick/investments/observations"||request.path.startsWith("/api/v1/lighttick/investments/observations/"))return handleObservations(runtime,owner,request,authorize);
  if(request.path==="/api/v1/lighttick/investments/screening"||request.path.startsWith("/api/v1/lighttick/investments/screening/"))return handleScreening(runtime,owner,request,authorize);
  if (
    request.path === "/api/v1/lighttick/investments/research-ai" ||
    request.path.startsWith("/api/v1/lighttick/investments/research-ai/")
  )
    return handleResearchAI(runtime, owner, request, authorize);
  if (
    request.path === "/api/v1/lighttick/account/github" ||
    request.path.startsWith("/api/v1/lighttick/account/github/")
  )
    return handleGitHubRequest(runtime, owner, request, authorize);
  return handlePersonalModelRequest(runtime, owner, request, authorize);
}
