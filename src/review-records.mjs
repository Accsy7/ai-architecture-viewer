const list = (value) => Array.isArray(value) ? value : [];

export function buildReviewRecords({ revisions = [], runs = [], proposals = [] } = {}) {
  const publications = list(revisions)
    .filter((revision) => ['publish', 'restore'].includes(revision.origin))
    .map((revision) => ({
      id: `publication-${revision.revisionId}`,
      kind: 'publication',
      decision: revision.origin,
      revision: revision.revision,
      revisionId: revision.revisionId,
      summary: revision.message,
      reviewedAt: revision.publishedAt,
      reviewer: revision.publishedBy,
    }));
  const implementationReviews = list(runs)
    .filter((run) => run.humanReview)
    .map((run) => ({
      id: `implementation-${run.id}`,
      kind: 'implementation',
      agentName: run.agentName || run.id,
      summary: run.humanReview.note,
      decision: run.humanReview.decision,
      reviewedAt: run.humanReview.reviewedAt,
      reviewer: run.humanReview.reviewer,
    }));
  const legacyProposalReviews = list(proposals)
    .filter((proposal) => ['accepted', 'approved', 'partially_accepted', 'rejected'].includes(proposal.status))
    .map((proposal) => ({
      id: proposal.id,
      kind: 'legacy-proposal',
      title: proposal.title,
      summary: proposal.summary,
      status: proposal.status,
      reviewedAt: proposal.reviewedAt,
      proposal,
    }));
  return [...publications, ...implementationReviews, ...legacyProposalReviews]
    .sort((left, right) => Date.parse(right.reviewedAt || 0) - Date.parse(left.reviewedAt || 0));
}
