import { ApprovalWorkflow } from './approval-workflow';
import { SupervisorAdvisoryService } from './supervisor-advisory.service';
import { AdvisoryRequest, AdvisoryDecision } from './models/advisory-recommendation.model';

export class ApprovalWorkflowController {
  constructor(
    private workflow: ApprovalWorkflow,
    private advisoryService: SupervisorAdvisoryService
  ) {}

  async createAdvisory(request: AdvisoryRequest): Promise<{
    success: boolean;
    data?: unknown;
    error?: string;
  }> {
    try {
      const recommendation = await this.workflow.requestAdvisory(request);
      return { success: true, data: recommendation };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getAdvisory(advisoryId: string): Promise<{
    success: boolean;
    data?: unknown;
    error?: string;
  }> {
    try {
      const recommendation = await this.advisoryService.getAdvisory(advisoryId);
      if (!recommendation) {
        return { success: false, error: 'Advisory not found' };
      }
      return { success: true, data: recommendation };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async submitDecision(decision: AdvisoryDecision): Promise<{
    success: boolean;
    data?: unknown;
    error?: string;
  }> {
    try {
      const result = await this.workflow.processDecision(decision);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getContextHistory(contextId: string): Promise<{
    success: boolean;
    data?: unknown;
    error?: string;
  }> {
    try {
      const context = await this.advisoryService.getContextHistory(contextId);
      return { success: true, data: context };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
