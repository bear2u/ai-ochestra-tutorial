import { SupervisorAdvisory } from './supervisor-advisory';
import { AdvisoryRepository } from './repositories/advisory-recommendation.repository';
import { AdvisoryRequest, AdvisoryRecommendation, AdvisoryContext } from './models/advisory-recommendation.model';

export interface SupervisorAdvisoryServiceConfig {
  enableAdvisoryOnly: boolean;
  confidenceThreshold: number;
}

export class SupervisorAdvisoryService {
  private advisor: SupervisorAdvisory;

  constructor(
    config: SupervisorAdvisoryServiceConfig,
    private repository: AdvisoryRepository
  ) {
    this.advisor = new SupervisorAdvisory({
      enableAdvisoryOnly: config.enableAdvisoryOnly,
      confidenceThreshold: config.confidenceThreshold
    });
  }

  async generateAndStore(request: AdvisoryRequest): Promise<AdvisoryRecommendation> {
    const recommendation = await this.advisor.generateAdvisory(request);
    await this.repository.save(recommendation);
    return recommendation;
  }

  async getAdvisory(advisoryId: string): Promise<AdvisoryRecommendation | null> {
    return this.repository.findByAdvisoryId(advisoryId);
  }

  async getContextHistory(contextId: string): Promise<AdvisoryContext> {
    const history = await this.repository.findByContextId(contextId);
    return { contextId, history };
  }
}
