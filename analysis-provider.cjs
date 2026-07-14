'use strict';

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';

class AnalysisProviderError extends Error {
  constructor(message, code = 'AI_PROVIDER_FAILED', status = 502) {
    super(message);
    this.name = 'AnalysisProviderError';
    this.code = code;
    this.status = status;
  }
}

function configuredText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function deepSeekMessages(input) {
  return [
    {
      role: 'system',
      content: [
        '你是一个架构治理分析助手。只基于提供的架构图和证据提出小而可审阅的变更建议。',
        '返回严格 JSON 对象，顶层只能包含 proposals 数组；不要使用 Markdown。',
        '每个 proposal 只能包含 title、summary、confidence、evidenceIds、changes；confidence 只能是 low、medium 或 high。',
        '每个 change 只能包含 kind、targetType、targetId、summary、evidenceIds、patch。',
        'kind 是 add、update 或 remove；targetType 是 node 或 edge。',
        '不得生成 position、width、height、routingMode、sourcePort、targetPort、waypoints、controlledBoundaryPosture、humanConfirmed、confirmationNote、confirmedAt、documentRefs、group。',
        '新增节点的 patch 只给 data；新增边的 patch 只给 source、target、data。更新节点只能修改 data 中的允许字段；更新边只能修改 data 中的 label 或 relationType。',
        '任何结论都必须引用 evidenceIds；不确定时不提出变更。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify(input),
    },
  ];
}

function createDeepSeekProvider(options = {}) {
  const apiKey = configuredText(options.apiKey ?? process.env.DEEPSEEK_API_KEY, '');
  const baseUrl = configuredText(options.baseUrl ?? process.env.DEEPSEEK_BASE_URL, DEFAULT_DEEPSEEK_BASE_URL).replace(/\/+$/, '');
  const model = configuredText(options.model ?? process.env.DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_MODEL);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  return {
    describe() {
      return {
        provider: 'deepseek',
        configured: Boolean(apiKey),
        model,
      };
    },
    async generate(input) {
      if (!apiKey) {
        throw new AnalysisProviderError('尚未配置 AI 服务密钥', 'AI_PROVIDER_NOT_CONFIGURED', 503);
      }
      if (typeof fetchImpl !== 'function') {
        throw new AnalysisProviderError('当前运行环境不支持 AI 服务请求', 'AI_PROVIDER_UNAVAILABLE', 503);
      }

      let response;
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: deepSeekMessages(input),
            response_format: { type: 'json_object' },
            temperature: 0.2,
          }),
        });
      } catch {
        throw new AnalysisProviderError('AI 服务暂时不可访问，请稍后重试', 'AI_PROVIDER_UNAVAILABLE', 502);
      }

      if (!response.ok) {
        throw new AnalysisProviderError('AI 服务暂时无法生成提案，请稍后重试', 'AI_PROVIDER_FAILED', 502);
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new AnalysisProviderError('AI 服务返回了无效响应', 'AI_PROVIDER_INVALID_RESPONSE', 502);
      }
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new AnalysisProviderError('AI 服务没有返回可审阅的提案', 'AI_PROVIDER_EMPTY_RESPONSE', 502);
      }
      try {
        return JSON.parse(content);
      } catch {
        throw new AnalysisProviderError('AI 服务返回的提案格式无效', 'AI_PROVIDER_INVALID_RESPONSE', 502);
      }
    },
  };
}

module.exports = {
  AnalysisProviderError,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  createDeepSeekProvider,
};
