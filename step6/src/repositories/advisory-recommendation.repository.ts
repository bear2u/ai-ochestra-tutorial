import { AdvisoryRecommendation } from '../models/advisory-recommendation.model';

export class AdvisoryRepository {
  private storage: Map<string, AdvisoryRecommendation> = new Map();
  private contextIndex: Map<string, Set<string>> = new Map();

  async save(recommendation: AdvisoryRecommendation): Promise<void> {
    this.storage.set(recommendation.id, recommendation);
    
    const contextSet = this.contextIndex.get(recommendation.contextId);
    if (contextSet) {
      contextSet.add(recommendation.id);
    } else {
      this.contextIndex.set(recommendation.contextId, new Set([recommendation.id]));
    }
  }

  async findByAdvisoryId(advisoryId: string): Promise<AdvisoryRecommendation | null> {
    for (const rec of this.storage.values()) {
      if (rec.advisoryId === advisoryId) {
        return rec;
      }
    }
    return null;
  }

  async findByContextId(contextId: string): Promise<AdvisoryRecommendation[]> {
    const idSet = this.contextIndex.get(contextId);
    if (!idSet) return [];
    
    const recommendations: AdvisoryRecommendation[] = [];
    for (const id of idSet) {
      const rec = this.storage.get(id);
      if (rec) recommendations.push(rec);
    }
    return recommendations;
  }
}
