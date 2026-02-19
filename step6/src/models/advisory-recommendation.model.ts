export interface AdvisoryRecommendation {
  id: string;
  advisoryId: string;
  contextId: string;
  recommendation: 'approve' | 'reject' | 'request_changes';
  confidence: number;
  reasoning: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdvisoryRequest {
  contextId: string;
  forceReviewApprove: boolean;
  contextData?: Record<string, unknown>;
}

export interface AdvisoryDecision {
  advisoryId: string;
  decision: 'approved' | 'rejected' | 'pending';
  userId?: string;
  comment?: string;
}

export interface AdvisoryContext {
  contextId: string;
  history: AdvisoryRecommendation[];
}
