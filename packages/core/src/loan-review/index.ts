/**
 * Loan review module — prompt building and output parsing
 * for CMBS-methodology loan document review.
 */

export {
  buildLoanReviewPrompt,
  validateReviewDepth,
} from './prompt-builder.js'

export type {
  LoanReviewContext,
  ReviewDepth,
} from './prompt-builder.js'

export {
  parseLoanReview,
} from './output-parser.js'

export type {
  LoanReviewHeatmap,
  LoanReviewRiskItem,
  LoanReviewEscalation,
} from './output-parser.js'
