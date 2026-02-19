import { SupervisorAdvisoryService } from './supervisor-advisory.service';
import { AdvisoryRequest, AdvisoryRecommendation, AdvisoryDecision } from './models/advisory-recommendation.model';

export interface ApprovalWorkflowConfig {
  enableStep6Advisory: boolean;
  requireForceReviewApprove: boolean;
}

export class ApprovalWorkflow {
  constructor(
    config: ApprovalWorkflowConfig,
    private advisoryService: SupervisorAdvisoryService
+  ) {}

  async requestAdvisory(request: AdvisoryRequest): Promise<AdvisoryRecommendation> {
    if (request.forceReviewApprove !== true) {
      throw new Error('force_review_approve must be true to request advisory');
+    }

    return this.advisoryService.generateAndStore(request);
  }

  async processDecision(decision: AdvisoryDecision): Promise<{
    success: boolean;
    message: string;
  }> {
    return {
      success: true,
      message: `Decision ${decision.decision} recorded for advisory ${decision.advisoryId}`
    };
  }
}
