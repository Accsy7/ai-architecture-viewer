'use strict';

const AGENT_NODE_DATA_FIELDS = Object.freeze([
  'name',
  'group',
  'purpose',
  'technical',
  'product',
  'authorization',
  'horizon',
  'focus',
  'buildStrategy',
  'aiCollaboration',
  'relatedDiagramId',
  'relatedNodeId',
  'documentRefs',
  'interactionModes',
  'architectureLayer',
]);

const AGENT_EDGE_DATA_FIELDS = Object.freeze([
  'label',
  'relationType',
  'controlledBoundaryPosture',
]);

const AGENT_EDGE_ENDPOINT_FIELDS = Object.freeze(['source', 'target']);

// Protocol 1.4 node updates may use an explicit null to remove only these
// optional semantic fields. Required node fields and every edge field remain
// non-nullable. Target-view horizon is additionally protected by the service.
const AGENT_NODE_CLEARABLE_FIELDS = Object.freeze([
  'horizon',
  'focus',
  'buildStrategy',
  'aiCollaboration',
  'relatedDiagramId',
  'relatedNodeId',
  'documentRefs',
  'interactionModes',
  'architectureLayer',
]);

module.exports = {
  AGENT_NODE_DATA_FIELDS,
  AGENT_NODE_CLEARABLE_FIELDS,
  AGENT_EDGE_DATA_FIELDS,
  AGENT_EDGE_ENDPOINT_FIELDS,
};
