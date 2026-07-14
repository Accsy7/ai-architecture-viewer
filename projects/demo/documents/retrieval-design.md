# Grounded response design

The retrieval service receives a normalized question from the policy router.
It reads only approved synthetic help-center snippets from the knowledge index.

The service may prepare contextual evidence for a draft response.
It cannot send a message, change the index, or bypass human review.

The grounded response flow diagram is a drill-down of this boundary.
