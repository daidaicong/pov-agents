import { extension_settings, getContext } from '../../../extensions.js';
import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../script.js';

const EXTENSION_KEY = 'povAgents';
const EXTENSION_VERSION = 'v7-prompt-editor';
const PROMPT_KEY = 'pov-agents-director-guidance';
const RECENT_PROMPT_KEY = 'pov-agents-recent-reminder';
const RESULT_PROMPT_KEY = 'pov-agents-child-result';
const RECENT_PROMPT_DEPTH = 0;
// Generation types that must never delegate (not real roleplay turns).
const SKIP_GENERATION_TYPES = ['impersonate', 'quiet', 'continue'];
const TOOL_NAME = 'ConsultLocalPOVAgent';
const TOOL_DISPLAY_NAME = 'Consult Local POV Agent / 咨询局部视角子代理';
const DEFAULT_SETTINGS = {
    enabled: false,
    aggressive: true,
    alwaysDelegate: true,
    forceCall: false,
    inlineDelegation: true,
    showTrace: true,
    showToast: true,
    connectionMode: 'custom',
    connectionProfileId: '',
    childApiUrl: '',
    childApiKey: '',
    childModel: '',
    childPreset: '',
    prompts: {},
    responseLength: 2048,
};
const MIN_RESPONSE_LENGTH = 64;
const RETRY_RESPONSE_LENGTHS = [4096, 8192, 16384];

function getSettings() {
    extension_settings[EXTENSION_KEY] ??= structuredClone(DEFAULT_SETTINGS);
    const settings = extension_settings[EXTENSION_KEY];
    settings.connectionProfileId ??= DEFAULT_SETTINGS.connectionProfileId;
    settings.connectionMode ??= DEFAULT_SETTINGS.connectionMode;
    settings.childApiUrl ??= DEFAULT_SETTINGS.childApiUrl;
    settings.childApiKey ??= DEFAULT_SETTINGS.childApiKey;
    settings.childModel ??= DEFAULT_SETTINGS.childModel;
    settings.childPreset ??= DEFAULT_SETTINGS.childPreset;
    settings.prompts ??= {};
    settings.inlineDelegation ??= DEFAULT_SETTINGS.inlineDelegation;
    settings.showTrace ??= DEFAULT_SETTINGS.showTrace;
    settings.showToast ??= DEFAULT_SETTINGS.showToast;
    settings.alwaysDelegate ??= DEFAULT_SETTINGS.alwaysDelegate;
    settings.aggressive ??= DEFAULT_SETTINGS.aggressive;
    settings.responseLength = Math.max(MIN_RESPONSE_LENGTH, Number(settings.responseLength) || DEFAULT_SETTINGS.responseLength);
    return settings;
}

function saveSettings() {
    getContext().saveSettingsDebounced();
}

function renderSettings() {
    const root = document.getElementById('extensions_settings2');
    if (!root || document.getElementById('pov_agents_settings')) return;

    const settings = getSettings();
    const context = getContext();
    const connectionProfiles = getPovConnectionProfiles();
    const selectedProfileExists = connectionProfiles.some(profile => profile.id === settings.connectionProfileId);
    const connectionOptions = [
        '<option value="">（未选择）</option>',
        ...connectionProfiles.map(profile => `<option value="${escapeHtml(profile.id)}" ${profile.id === settings.connectionProfileId ? 'selected' : ''}>${escapeHtml(profile.name || profile.api || profile.id)}</option>`),
    ].join('');
    const presetNames = getChatCompletionPresetNames();
    const presetOptions = [
        '<option value="">（不使用预设）</option>',
        ...presetNames.map(name => `<option value="${escapeHtml(name)}" ${name === settings.childPreset ? 'selected' : ''}>${escapeHtml(name)}</option>`),
    ].join('');
    const container = document.createElement('div');
    container.id = 'pov_agents_settings';
    container.className = 'extension_settings';
    container.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>POV Agents / 导演-局部视角代理（实验版 ${EXTENSION_VERSION}）</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input id="pov_agents_enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}>
                    <span>允许主模型按需调用局部视角子代理</span>
                </label>
                <label class="checkbox_label">
                    <input id="pov_agents_aggressive" type="checkbox" ${settings.aggressive ? 'checked' : ''}>
                    <span>更积极调用（每轮倾向推演一次在场角色的局部视角，触发率更高）</span>
                </label>
                <label class="checkbox_label">
                    <input id="pov_agents_inline" type="checkbox" ${settings.inlineDelegation ? 'checked' : ''}>
                    <span>子代理不占楼层（本轮结束后自动合并中间楼层，正文保持在原楼层；调用详情折叠显示在本楼内）</span>
                </label>
                <label class="checkbox_label">
                    <input id="pov_agents_always" type="checkbox" ${settings.alwaysDelegate ? 'checked' : ''}>
                    <span>每轮必委派（跳过"是否需要"判断，每次生成都必调用子代理）</span>
                </label>
                <label class="checkbox_label">
                    <input id="pov_agents_trace" type="checkbox" ${settings.showTrace ? 'checked' : ''}>
                    <span>在消息内显示子代理调用详情（默认折叠：task / context / role_instructions / 子代理返回）</span>
                </label>
                <label class="checkbox_label">
                    <input id="pov_agents_toast" type="checkbox" ${settings.showToast ? 'checked' : ''}>
                    <span>调用子代理时弹出提示（右上角短暂提示，便于确认本轮是否触发）</span>
                </label>
                <label for="pov_agents_mode">子代理连接方式</label>
                <select id="pov_agents_mode" class="text_pole">
                    <option value="custom" ${settings.connectionMode === 'custom' ? 'selected' : ''}>自定义 API（默认；全部留空即继承主 AI）</option>
                    <option value="main" ${settings.connectionMode === 'main' ? 'selected' : ''}>使用主模型连接</option>
                    <option value="profile" ${settings.connectionMode === 'profile' ? 'selected' : ''}>使用 Connection Manager 配置</option>
                </select>
                <small>要给子代理单独配 API / Key / 预设 → 保持选「自定义 API」即可（各字段留空则继承主 AI）。</small>

                <div id="pov_agents_profile_block">
                    <label for="pov_agents_connection_profile">Connection Manager 配置</label>
                    <select id="pov_agents_connection_profile" class="text_pole">${connectionOptions}</select>
                    <small>在 Connection Manager 中先保存 Chat Completion 配置（API、模型、URL、密钥凭据），再到这里选择。密钥使用酒馆的 Secret 管理。</small>
                </div>

                <div id="pov_agents_custom_block">
                    <small>以下字段<b>留空即继承主 AI</b>：地址空→用主 AI 的接口与密钥；模型空→用主 AI 的模型；预设空→用主 AI 当前预设。</small>
                    <label for="pov_agents_api_url">API 地址（留空 = 主 AI 的接口）</label>
                    <input id="pov_agents_api_url" class="text_pole" type="text" placeholder="（留空则用主 AI）https://api.deepseek.com/v1" value="${escapeHtml(settings.childApiUrl)}">
                    <label for="pov_agents_api_key">API Key（地址与主 AI 不同时必填）</label>
                    <input id="pov_agents_api_key" class="text_pole" type="password" placeholder="（留空则用主 AI 的密钥）" value="${escapeHtml(settings.childApiKey)}">
                    <small>密钥保存在你的 SillyTavern 用户设置文件中（仅本机）。如需加密存储，请改用 Connection Manager 方式。若地址与主 AI 相同，留空即自动用主 AI 的密钥。</small>
                    <label for="pov_agents_model">模型名（留空 = 主 AI 的模型）</label>
                    <input id="pov_agents_model" class="text_pole" type="text" placeholder="（留空则用主 AI）deepseek-chat" value="${escapeHtml(settings.childModel)}">
                    <label for="pov_agents_preset">预设（留空 = 主 AI 当前预设）</label>
                    <select id="pov_agents_preset" class="text_pole">${presetOptions}</select>
                    <small>预设的采样参数（temperature / top_p / 惩罚项等）会应用到子代理请求；不改变你的主对话设置。</small>
                </div>

                <details id="pov_agents_prompt_editor">
                    <summary><b>提示词模板（可自行修改）</b></summary>
                    <small>下面四段是扩展发给模型的全部提示词。留空 = 使用内置默认值；填了就用你的。点“恢复默认”可清空该项。</small>
                    ${Object.entries(PROMPT_TEMPLATES).map(([key, template]) => `
                        <div class="pov-prompt-field" data-key="${key}">
                            <label for="pov_agents_prompt_${key}"><b>${escapeHtml(template.label)}</b></label>
                            <small>${escapeHtml(template.hint)}</small>
                            <textarea id="pov_agents_prompt_${key}" class="text_pole textarea_compact" rows="6">${escapeHtml(getPromptTemplate(key))}</textarea>
                            <div class="flex-container">
                                <button class="menu_button pov-prompt-reset" data-key="${key}">恢复默认</button>
                                <small class="pov-prompt-state"></small>
                            </div>
                        </div>`).join('')}
                </details>

                <label for="pov_agents_response_length">子代理最大回复长度（token）</label>
                <input id="pov_agents_response_length" class="text_pole" type="number" min="${MIN_RESPONSE_LENGTH}" value="${settings.responseLength}">
                <small>子代理输出上限（token），不设上限。若子模型是推理模型（思考会先占用 token），请调大（建议 4096 以上）。</small>
                <div class="flex-container">
                    <button id="pov_agents_save" class="menu_button">保存设置</button>
                    <button id="pov_agents_test" class="menu_button">测试子代理连接</button>
                    <small id="pov_agents_status"></small>
                </div>
            </div>
        </div>`;
    root.append(container);

    const customBlock = container.querySelector('#pov_agents_custom_block');
    const profileBlock = container.querySelector('#pov_agents_profile_block');
    const modeSelect = container.querySelector('#pov_agents_mode');

    const syncModeVisibility = () => {
        customBlock.style.display = modeSelect.value === 'custom' ? '' : 'none';
        profileBlock.style.display = modeSelect.value === 'profile' ? '' : 'none';
    };
    modeSelect.addEventListener('change', syncModeVisibility);
    syncModeVisibility();

    container.querySelectorAll('.pov-prompt-reset').forEach(button => {
        button.addEventListener('click', () => {
            const key = button.dataset.key;
            const field = container.querySelector(`#pov_agents_prompt_${key}`);
            if (field) {
                field.value = PROMPT_TEMPLATES[key].value;
            }
            const state = button.parentElement?.querySelector('.pov-prompt-state');
            if (state) {
                state.textContent = '已恢复默认（记得点“保存设置”生效）';
            }
        });
    });

    container.querySelector('#pov_agents_save').addEventListener('click', () => {
        const settings = getSettings();
        settings.enabled = container.querySelector('#pov_agents_enabled').checked;
        settings.aggressive = container.querySelector('#pov_agents_aggressive').checked;
        settings.forceCall = container.querySelector('#pov_agents_force')?.checked ?? false;
        settings.inlineDelegation = container.querySelector('#pov_agents_inline')?.checked ?? true;
        settings.showTrace = container.querySelector('#pov_agents_trace').checked;
        settings.showToast = container.querySelector('#pov_agents_toast').checked;
        settings.alwaysDelegate = container.querySelector('#pov_agents_always').checked;
        settings.connectionMode = modeSelect.value;
        settings.connectionProfileId = container.querySelector('#pov_agents_connection_profile').value;
        settings.childApiUrl = container.querySelector('#pov_agents_api_url').value.trim();
        settings.childModel = container.querySelector('#pov_agents_model').value.trim();
        settings.childApiKey = container.querySelector('#pov_agents_api_key').value.trim();
        settings.childPreset = container.querySelector('#pov_agents_preset').value;
        settings.responseLength = Number(container.querySelector('#pov_agents_response_length').value) || DEFAULT_SETTINGS.responseLength;

        // Only store prompt overrides that actually differ from the built-in defaults.
        settings.prompts = {};
        for (const key of Object.keys(PROMPT_TEMPLATES)) {
            const field = container.querySelector(`#pov_agents_prompt_${key}`);
            const value = field ? field.value.trim() : '';
            if (value && value !== PROMPT_TEMPLATES[key].value) {
                settings.prompts[key] = value;
            }
        }
        getSettings();
        saveSettings();
        for (let i = 0; i < context.chat.length; i++) {
            renderDelegationTrace(i, true);
        }
        container.querySelector('#pov_agents_status').textContent = describeConnection(settings);
    });

    container.querySelector('#pov_agents_test').addEventListener('click', async () => {
        const status = container.querySelector('#pov_agents_status');
        status.textContent = '正在测试子代理连接…';
        try {
            const reply = await consultLocalPovAgent({
                task: '用一句话回答：连接测试成功。',
                context: '这是一次连接测试。',
                role_instructions: '',
            });
            status.textContent = `✅ 连接成功，子代理返回 ${reply.length} 字：${reply.slice(0, 40)}…`;
        } catch (error) {
            status.textContent = `❌ 连接失败：${error?.message ?? error}`;
        }
    });
}

/**
 * @param {object} settings Extension settings
 * @returns {string} Human readable connection description
 */
function describeConnection(settings) {
    if (!settings.enabled) return '已关闭。';
    if (settings.connectionMode === 'custom') {
        const ownUrl = settings.childApiUrl.trim();
        const parts = [];
        parts.push(ownUrl ? `地址=${ownUrl}` : '地址=主AI');
        parts.push(settings.childModel.trim() ? `模型=${settings.childModel}` : '模型=主AI');
        parts.push(settings.childApiKey.trim() ? '密钥=自定义' : '密钥=主AI');
        parts.push(settings.childPreset ? `预设=${settings.childPreset}` : '预设=主AI');
        return `已启用。子代理（${parts.join('，')}）`;
    }
    if (settings.connectionMode === 'profile') {
        return settings.connectionProfileId
            ? '已启用。子代理使用所选 Connection Manager 配置。'
            : '已启用，但未选择 Connection Manager 配置。';
    }
    return '已启用。子代理使用主模型连接。';
}

/**
 * @returns {string[]} Available chat completion preset names
 */
function getChatCompletionPresetNames() {
    try {
        const manager = getContext().getPresetManager?.('openai');
        return manager?.getAllPresets?.() ?? [];
    } catch (error) {
        console.warn('[POV Agents] Failed to read chat completion presets.', error);
        return [];
    }
}

/**
 * Maps a chat completion source to the settings field holding its model name.
 */
const MODEL_FIELD_BY_SOURCE = {
    openai: 'openai_model',
    custom: 'custom_model',
    claude: 'claude_model',
    makersuite: 'google_model',
    vertexai: 'vertexai_model',
    deepseek: 'deepseek_model',
    openrouter: 'openrouter_model',
    mistralai: 'mistralai_model',
    cohere: 'cohere_model',
    groq: 'groq_model',
    xai: 'xai_model',
    ai21: 'ai21_model',
    perplexity: 'perplexity_model',
    moonshot: 'moonshot_model',
    fireworks: 'fireworks_model',
    aimlapi: 'aimlapi_model',
    electronhub: 'electronhub_model',
    nanogpt: 'nanogpt_model',
    cometapi: 'cometapi_model',
    pollinations: 'pollinations_model',
    azure_openai: 'azure_openai_model',
};

/**
 * Reads the main connection's source / url / model, used as fallback for empty fields.
 * @returns {{source: string, url: string, model: string}} Main connection info
 */
function getMainConnectionInfo() {
    const oai = getContext().chatCompletionSettings ?? {};
    const source = String(oai.chat_completion_source ?? 'openai');
    const url = source === 'custom'
        ? String(oai.custom_url ?? '')
        : (source === 'azure_openai' ? String(oai.azure_base_url ?? '') : '');
    const model = String(oai[MODEL_FIELD_BY_SOURCE[source] ?? `${source}_model`] ?? '');
    return { source, url, model };
}

/**
 * Creates an error that must not be retried (bad configuration, not a token budget issue).
 * @param {string} message Error message
 * @returns {Error} Tagged error
 */
function configError(message) {
    const error = new Error(message);
    error.povConfigError = true;
    return error;
}

function getPovConnectionProfiles() {
    const context = getContext();
    if (context.extensionSettings.disabledExtensions.includes('connection-manager')) return [];

    try {
        return context.ConnectionManagerRequestService.getSupportedProfiles()
            .filter(profile => profile.mode === 'cc' && context.ConnectionManagerRequestService.isProfileSupported(profile));
    } catch (error) {
        console.warn('[POV Agents] Failed to read Connection Manager profiles.', error);
        return [];
    }
}

function getSelectedConnectionProfile() {
    const settings = getSettings();
    if (!settings.connectionProfileId) return null;

    const profile = getPovConnectionProfiles().find(item => item.id === settings.connectionProfileId);
    if (!profile) {
        throw new Error('找不到所选子代理连接配置。请检查 Connection Manager 是否启用，以及该配置是否仍存在。');
    }
    return profile;
}

async function consultLocalPovAgent({ task, context, role_instructions = '' } = {}) {
    if (typeof task !== 'string' || !task.trim()) {
        throw new Error('task 不能为空。');
    }

    const agentTask = task.trim();
    const agentContext = String(context ?? '').trim();
    const agentRoleInstructions = String(role_instructions ?? '').trim();
    const systemPrompt = applyTemplate(getPromptTemplate('childSystem'), {
        roleInstructions: agentRoleInstructions ? `主 AI 提供的角色视角/限制：\n${agentRoleInstructions}` : '',
    }).trim();
    const prompt = [
        `主 AI 的具体任务：\n${agentTask}`,
        agentContext ? `主 AI 选出的相关上下文（仅此为你可用的场景材料）：\n${agentContext}` : '主 AI 没有提供额外场景材料；请明确说明信息不足。',
    ].join('\n\n');

    const connectionProfile = getSelectedConnectionProfile();
    const settings = getSettings();
    const requestOnce = async (responseLength) => {
        // 1) Custom API configured inside this extension (independent URL / key / preset).
        //    Any empty field falls back to the main connection.
        if (settings.connectionMode === 'custom') {
            const context = getContext();
            const main = getMainConnectionInfo();
            const ownUrl = settings.childApiUrl.trim();

            // Nothing configured and the main API is not a chat-completion backend:
            // fall back to the main model, which works with any main API.
            if (!ownUrl && context.mainApi !== 'openai') {
                const result = await context.generateRaw({
                    prompt,
                    systemPrompt,
                    responseLength,
                    quietToLoud: false,
                    trimNames: true,
                });
                return String(result || '').trim();
            }

            if (typeof context.ChatCompletionService?.processRequest !== 'function') {
                throw configError('当前酒馆版本不支持 ChatCompletionService，请改用 Connection Manager 或主模型连接。');
            }

            const useOwnEndpoint = Boolean(ownUrl) && ownUrl !== main.url;

            const payload = {
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt },
                ],
                model: settings.childModel.trim() || main.model || undefined,
                max_tokens: responseLength,
            };

            if (useOwnEndpoint) {
                if (!settings.childApiKey.trim()) {
                    throw configError('自定义 API 地址与主 AI 不同时，必须填写 API Key（子代理无法读取主 AI 的密钥）。');
                }
                // reverse_proxy + proxy_password make the backend use OUR url and key.
                payload.chat_completion_source = 'openai';
                payload.reverse_proxy = ownUrl;
                payload.proxy_password = settings.childApiKey.trim();
            } else {
                // Reuse the main AI endpoint and its stored secret.
                payload.chat_completion_source = main.source;
                if (main.source === 'custom' && main.url) {
                    payload.custom_url = main.url;
                }
            }

            const result = await context.ChatCompletionService.processRequest(
                payload,
                { presetName: settings.childPreset || undefined },
                true,
                undefined,
            );

            if (!result || typeof result !== 'object') {
                throw new Error('自定义 API 未返回有效响应。');
            }
            return String(result.content ?? '').trim();
        }

        // 2) Connection Manager profile.
        if (settings.connectionMode === 'profile' || connectionProfile) {
            if (!connectionProfile) {
                throw configError('未选择有效的 Connection Manager 配置。');
            }
            const result = await getContext().ConnectionManagerRequestService.sendRequest(
                connectionProfile.id,
                [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt },
                ],
                responseLength,
                {
                    stream: false,
                    extractData: true,
                    includePreset: true,
                    includeInstruct: false,
                },
            );
            if (!result || typeof result !== 'object' || !('content' in result)) {
                throw new Error('子代理 API 未返回有效文本响应。');
            }
            return String(result.content || '').trim();
        }

        // 3) Main model connection.
        const result = await getContext().generateRaw({
            prompt,
            systemPrompt,
            responseLength,
            quietToLoud: false,
            trimNames: true,
        });
        return String(result || '').trim();
    };

    const baseLength = getSettings().responseLength;
    const attemptLengths = [...new Set([
        baseLength,
        ...RETRY_RESPONSE_LENGTHS.filter(length => length > baseLength),
    ])].sort((a, b) => a - b);

    let firstError;
    let reply = '';
    for (const responseLength of attemptLengths) {
        try {
            reply = await requestOnce(responseLength);
        } catch (error) {
            // Configuration problems won't be fixed by a bigger token budget.
            if (error?.povConfigError) {
                throw error;
            }
            firstError ??= error;
            reply = '';
        }
        // Reasoning models may spend the whole budget on hidden reasoning (empty content,
        // finish_reason "length"); escalate to a larger budget before giving up.
        if (reply) break;
    }

    if (!reply) {
        throw new Error(`子代理未返回正文内容${firstError ? `（最后一次错误：${firstError.message}）` : ''}。若使用推理模型，思考过程会消耗 token，请提高“子代理最大回复长度”。`, { cause: firstError });
    }
    return reply;
}

/**
 * Builds a compact excerpt of the recent conversation for the director decision call.
 * @param {object[]} chat Chat messages
 * @returns {string} Excerpt text
 */
function buildSceneExcerpt(chat) {
    const parts = [];
    for (const message of chat.slice(-12)) {
        const text = String(message.mes ?? '').trim();
        if (!text) continue;
        const who = message.is_user ? '用户' : (message.name || '角色');
        parts.push(`【${who}】${text}`);
    }
    const joined = parts.join('\n\n');
    return joined.length > 6000 ? joined.slice(-6000) : joined;
}

/**
 * Collects character card fields and currently activated world info.
 * @param {object} context SillyTavern context
 * @param {object[]} chat Chat messages
 * @returns {Promise<string>} Setting excerpt
 */
async function buildSettingExcerpt(context, chat) {
    const parts = [];

    const character = context.characters?.[context.characterId];
    if (character) {
        const fields = [character.description, character.personality, character.scenario].filter(Boolean);
        if (fields.length) {
            parts.push(`【角色卡】\n${fields.join('\n')}`);
        }
    }

    try {
        // getWorldInfoPrompt expects an array of plain message strings.
        const messages = chat.map(message => String(message.mes ?? ''));
        const worldInfo = await context.getWorldInfoPrompt(messages, context.maxContext, true);
        const text = typeof worldInfo === 'string' ? worldInfo : (worldInfo?.worldInfoString ?? '');
        if (text) {
            parts.push(`【已激活世界书】\n${text}`);
        }
    } catch {
        // World info is optional.
    }

    return parts.join('\n\n');
}

/**
 * Extracts the first JSON object from a model reply.
 * @param {string} text Model reply
 * @returns {object|null} Parsed object
 */
function parseDecision(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

/**
 * Every prompt the extension feeds to a model is defined here as a template, so users
 * can override any of them from the settings panel. Placeholders use {{name}}.
 */
const PROMPT_TEMPLATES = {
    decisionSystem: {
        label: '① 导演决策 — 系统提示',
        hint: '发给主 AI，用于判断"本轮是否需要子代理"。占位符：无。',
        value: [
            '你是本轮叙事的导演，掌握完整上下文。你的任务：判断本轮是否需要咨询一个"局部视角子代理"来推演某个角色的有限认知。',
            '需要：本轮要写某个角色的具体反应、内心或台词，且该角色只掌握部分信息（存在信息差、隐瞒、误会或立场冲突）。',
            '不需要：纯环境描写、纯客观事件推进、不涉及任何角色内心。',
            '只输出一个 JSON 对象，不要输出任何其他文字、解释或代码块标记。',
        ].join('\n'),
    },
    decisionFormat: {
        label: '② 导演决策 — 参数格式与纪律',
        hint: '接在系统提示之后，规定 JSON 结构与参数纪律。占位符：无。',
        value: [
            '需要时输出：{"delegate":true,"task":"...","context":"...","role_instructions":"..."}',
            '不需要时输出：{"delegate":false}',
            '参数纪律：',
            '- task：只客观说明"要推演什么"，禁止写入你的结论、倾向、剧情走向或期望答案。',
            '- context：只能是该角色能客观感知到的事实（亲眼所见、亲耳所闻、已知）；严禁写入任何人的内心活动、动机、情绪、未公开秘密或全知设定。',
            '- role_instructions：只写该角色自己的性格、身份、语气与认知边界。',
        ].join('\n'),
    },
    childSystem: {
        label: '③ 子代理 — 系统提示',
        hint: '发给子 AI 的角色约束与输出格式。占位符：{{roleInstructions}}（主 AI 填写的角色视角/边界，可能为空）。',
        value: [
            '你是一个被主 AI 临时调用的局部视角子代理。主 AI 是导演，掌握完整上下文；你只获得它明确传来的任务与材料。',
            '绝不假定你看到了未提供的角色卡、世界书、聊天记录或设定。把材料当作全部可用证据；缺失信息必须指出，不可补造。',
            '只分析角色在所给局部情境中的认知、判断、可能意图和候选行为。不要替主 AI 推进客观世界，不要裁定其他角色的行动或隐藏事实。',
            '若材料中出现内心活动、动机或结论性描述，请把它视为未经证实的导演假设，不要直接当客观事实照抄；仍要基于可见线索独立推演。',
            '给出可直接供主 AI 取舍的建议；区分材料明确支持的内容与推测，并指出关键不确定性。',
            '输出格式：先给出分析，最后另起一节，标题写成 `### 三条结论`，下面用三行短句（每行不超过 30 字）依次列出：① 该角色的认知边界（不知道什么）；② 此刻的情绪/身体状态；③ 最可能的行为方向。三行必须能被主 AI 直接当作写作依据。',
            '',
            '{{roleInstructions}}',
        ].join('\n'),
    },
    injection: {
        label: '④ 结果回注 — 给主 AI 的使用要求',
        hint: '子代理返回后注入到本轮提示的内容。占位符：{{keyPoints}}、{{keyPointsBlock}}、{{childReply}}。',
        value: [
            '【子代理推演结果 —— 本轮正文必须依据，优先级高于你的自由发挥】',
            '',
            '{{keyPointsBlock}}',
            '',
            '【完整推演】',
            '{{childReply}}',
            '',
            '【使用要求】',
            '1. 你在思考的第三步（设计情节元素）时，必须明确引用上面「必须采用的结论」，逐条说明如何落实。',
            '2. 正文中该角色的所见、所想、反应必须落在这些结论限定的有限视角内；不得让它表现得知情、熟练或超出推演范围。',
            '3. 不要原文照抄推演文本，把它当作角色行为与情绪的依据。',
        ].join('\n'),
    },
};

/**
 * Replaces {{placeholders}} in a template. Unknown placeholders become empty strings.
 * @param {string} template Template text
 * @param {Record<string, string>} values Placeholder values
 * @returns {string} Filled text
 */
function applyTemplate(template, values) {
    return String(template ?? '').replace(/\{\{(\w+)\}\}/g, (match, key) => {
        const value = values[key];
        return value === undefined || value === null ? '' : String(value);
    }).replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * @param {keyof typeof PROMPT_TEMPLATES} key Template key
 * @returns {string} User override, or the built-in default
 */
function getPromptTemplate(key) {
    const override = getSettings().prompts?.[key];
    return (typeof override === 'string' && override.trim()) ? override : PROMPT_TEMPLATES[key].value;
}

/**
 * Runs the whole delegation before the main generation, so nothing extra ever
 * appears in the chat: the director decision and the child call both happen here,
 * and only the child's answer is injected into the prompt of the single generation
 * that follows.
 * @param {object[]} chat Chat messages (already regex-processed)
 * @param {number} _contextSize Context size
 * @param {AbortSignal} abort Abort signal
 * @param {string} type Generation type
 */
async function runPovAgentDirectorGuidance(chat, _contextSize, abort, type) {
    setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_PROMPT, 0);
    setExtensionPrompt(RECENT_PROMPT_KEY, '', extension_prompt_types.IN_CHAT, RECENT_PROMPT_DEPTH);
    setExtensionPrompt(RESULT_PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0);

    if (!getSettings().enabled) return;
    // SillyTavern passes `undefined` when the user sends a message from the chat box
    // (sendTextareaMessage -> Generate(generateType)), so only skip types that must
    // never delegate.
    if (SKIP_GENERATION_TYPES.includes(type)) return;
    if (abort?.aborted) return;

    console.debug(`[POV Agents] 拦截器已运行 (type=${type ?? 'undefined'})，开始导演决策。`);

    const context = getContext();

    try {
        const decisionPrompt = [
            getPromptTemplate('decisionFormat'),
            getSettings().alwaysDelegate ? '【强制委派】本轮必须委派。直接输出 delegate=true 及 task/context/role_instructions，禁止输出 {"delegate":false}。若不确定推演哪个角色，就选本轮最活跃/最受影响的那个。' : '',
            getSettings().aggressive ? '（更积极模式）除非本轮完全不涉及任何角色，否则请委派一次。' : '',
            await buildSettingExcerpt(context, chat),
            `【最近对话】\n${buildSceneExcerpt(chat)}`,
        ].filter(Boolean).join('\n\n');

        const rawDecision = await requestMainModel(context, decisionPrompt, getPromptTemplate('decisionSystem'));
        if (abort?.aborted) return;

        const decision = parseDecision(rawDecision);
        if (!decision?.delegate || !String(decision.task ?? '').trim()) {
            console.debug('[POV Agents] 导演判断本轮无需子代理。', rawDecision.slice(0, 200));
            if (getSettings().showToast && typeof toastr !== 'undefined') {
                toastr.info('本轮未委派（导演判断无需子代理）', 'POV Agents', { timeOut: 4000 });
            }
            return;
        }

        const task = String(decision.task ?? '').trim();
        const agentContext = String(decision.context ?? '').trim();
        const roleInstructions = String(decision.role_instructions ?? '').trim();

        console.debug('[POV Agents] 导演决定委派子代理，正在调用…');

        const childReply = await consultLocalPovAgent({ task, context: agentContext, role_instructions: roleInstructions });
        if (abort?.aborted) return;

        const keyPoints = extractKeyPoints(childReply);

        setExtensionPrompt(
            RESULT_PROMPT_KEY,
            applyTemplate(getPromptTemplate('injection'), {
                keyPoints,
                keyPointsBlock: keyPoints ? `【必须采用的结论】\n${keyPoints}` : '',
                childReply,
            }),
            extension_prompt_types.IN_CHAT,
            0,
            false,
            extension_prompt_roles.ASSISTANT,
        );

        pendingInvocationRecord = [{
            id: `pov-${Date.now()}`,
            displayName: TOOL_DISPLAY_NAME,
            name: TOOL_NAME,
            parameters: JSON.stringify({ task, context: agentContext, role_instructions: roleInstructions }),
            result: childReply,
            keyPoints,
        }];

        console.debug('[POV Agents] 子代理结果已注入本轮提示（不产生额外楼层）。');
    } catch (error) {
        console.warn('[POV Agents] 委派流程失败，本轮将正常生成。', error);
    }
}

/**
 * Asks the main model for a short answer (used for the director decision).
 * @param {object} context SillyTavern context
 * @param {string} prompt User prompt
 * @param {string} systemPrompt System prompt
 * @returns {Promise<string>} Model reply
 */
async function requestMainModel(context, prompt, systemPrompt) {
    const lengths = [8192, 16384];
    let lastError;
    for (const responseLength of lengths) {
        try {
            const reply = await context.generateRaw({
                prompt,
                systemPrompt,
                responseLength,
                quietToLoud: false,
                trimNames: true,
            });
            const text = String(reply || '').trim();
            if (text) return text;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError ?? new Error('主模型未返回决策内容。');
}

let hasWarnedToolCallingUnavailable = false;

/**
 * SillyTavern's native tool-calling flow always leaves extra chat entries behind:
 * an empty assistant message (the tool-call turn) plus a separate "tool result"
 * system message, and the follow-up generation becomes yet another message.
 *
 * "Inline delegation" collapses all of that into a single floor once the whole
 * generation chain has finished — deterministic, no mid-stream surgery:
 *  1. the empty tool-call message and the tool-result message are removed,
 *  2. the invocation record is moved onto the surviving message's `extra`
 *     (kept in the chat file, shown as a collapsed block in the UI),
 *  3. the final prose therefore stays on the original floor.
 */
function installInlineDelegation() {
    const context = getContext();

    context.eventSource.on(context.eventTypes.TOOL_CALLS_PERFORMED, invocations => {
        if (!getSettings().enabled || !getSettings().inlineDelegation) return;
        if (!Array.isArray(invocations) || !invocations.length) return;

        const ours = invocations.filter(invocation => invocation.name === TOOL_NAME);
        if (!ours.length) return;

        delegationFollowUpArmed = true;
        pendingInvocationRecord = ours.map(invocation => ({ ...invocation }));
        console.debug('[POV Agents] 已记录子代理调用，将在本轮结束时合并中间楼层。');
        scheduleCollapse();
    });

    context.eventSource.on(context.eventTypes.GENERATION_ENDED, () => {
        if (!Array.isArray(pendingInvocationRecord) || !pendingInvocationRecord.length) return;

        const last = context.chat[context.chat.length - 1];
        if (last && !last.is_user && !last.is_system) {
            last.extra ??= {};
            last.extra.tool_invocations = pendingInvocationRecord;
            context.saveChat();
            renderDelegationTrace(context.chat.length - 1);
        }

        if (getSettings().showToast) {
            const target = describeDelegationTarget(pendingInvocationRecord);
            if (typeof toastr !== 'undefined') {
                toastr.info(`已调用局部视角子代理${target ? `：${target}` : ''}`, 'POV Agents', { timeOut: 5000 });
            }
        }

        pendingInvocationRecord = null;
    });

    // The end of the chain is signalled by different events depending on whether the
    // user sent a message or hit "regenerate". Debounce on several of them and just
    // try to normalise once the dust settles.
    context.eventSource.on(context.eventTypes.GENERATION_ENDED, scheduleCollapse);
    context.eventSource.on(context.eventTypes.TOOL_CALLS_RENDERED, scheduleCollapse);
    context.eventSource.on(context.eventTypes.CHARACTER_MESSAGE_RENDERED, scheduleCollapse);

    const reRender = messageId => renderDelegationTrace(messageId);
    context.eventSource.on(context.eventTypes.CHARACTER_MESSAGE_RENDERED, reRender);
    context.eventSource.on(context.eventTypes.USER_MESSAGE_RENDERED, reRender);
    context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => {
        setTimeout(() => {
            const total = getContext().chat.length;
            for (let i = 0; i < total; i++) {
                renderDelegationTrace(i);
            }
        }, 300);
    });
}

/**
 * @returns {boolean} Whether a generation is currently running (streaming or waiting).
 */
function isGenerating() {
    if (document.querySelector('#chat .mes.streaming')) return true;
    const stopButton = document.getElementById('mes_stop');
    if (stopButton && stopButton.offsetParent !== null) return true;
    const sendButton = document.getElementById('send_but');
    return !!sendButton?.classList.contains('fa-stop');
}

let collapseTimer = null;
let collapseRetries = 0;

/**
 * Debounced floor normalisation. Safe to call many times: it only acts when extra
 * tool-call entries are actually present, and it waits until generation has fully
 * stopped (touching the chat mid-stream corrupts the streaming processor).
 */
function scheduleCollapse() {
    if (!getSettings().enabled || !getSettings().inlineDelegation) return;
    if (!delegationFollowUpArmed) return;

    if (collapseTimer) {
        clearTimeout(collapseTimer);
    }
    collapseTimer = setTimeout(() => {
        collapseTimer = null;

        // Never touch the chat while a generation is still running.
        if (isGenerating() && collapseRetries < 60) {
            collapseRetries++;
            scheduleCollapse();
            return;
        }
        collapseRetries = 0;

        try {
            const collapsed = collapseDelegationFloors(pendingInvocationRecord);
            if (collapsed) {
                pendingInvocationRecord = null;
                delegationFollowUpArmed = false;
            }
        } catch (error) {
            console.warn('[POV Agents] 合并中间楼层失败。', error);
        }
    }, 700);
}

/**
 * Some presets make the model emit its chain of thought as message content
 * (`<thinking>...</thinking>`) instead of the API reasoning field. Such a message
 * has no actual reply, so it counts as empty for floor-collapsing purposes.
 * @param {object} message Chat message
 * @returns {boolean} Whether the message contains no visible reply
 */
function isEffectivelyEmptyAssistant(message) {
    if (!message || message.is_system || message.is_user) return false;

    const raw = String(message.mes ?? '').trim();
    if (raw === '' || raw === '...') return true;
    if (!raw.includes('<thinking>')) return false;

    const rest = raw
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<thinking>[\s\S]*$/i, '')
        .replace(/<\/?(content|suggestions)>/gi, '');

    return rest.trim() === '';
}

/**
 * Collapses the chat entries SillyTavern creates for a tool call into a single floor.
 *
 * Native layout (either path) is:
 *   [... , <reply slot (tool-call turn, no visible reply)>, <tool result (system)>, <fresh assistant with prose>]
 *
 * This keeps the *reply slot* (so swipes and position are preserved), writes the prose
 * into it, stores the invocation record on its `extra`, and drops the rest.
 *
 * @param {object[]|null} record Child-agent invocation record to preserve
 * @returns {boolean} Whether anything was collapsed
 */
function collapseDelegationFloors(record) {
    const context = getContext();
    const chat = context.chat;

    let finalIndex = chat.length - 1;
    while (finalIndex >= 0 && (chat[finalIndex].is_system || chat[finalIndex].is_user)) {
        finalIndex--;
    }
    if (finalIndex < 0) return false;

    const finalMessage = chat[finalIndex];

    let start = finalIndex;
    for (let i = finalIndex - 1; i >= 0; i--) {
        const message = chat[i];
        const isToolResult = message.is_system && Array.isArray(message.extra?.tool_invocations);
        if (isToolResult || isEffectivelyEmptyAssistant(message)) {
            start = i;
            continue;
        }
        break;
    }

    if (start === finalIndex) return false;

    const segment = chat.slice(start, finalIndex + 1);
    const slotIndex = segment.findIndex(isEffectivelyEmptyAssistant);
    const survivor = slotIndex >= 0 ? segment[slotIndex] : finalMessage;

    // Move the generated prose (and its reasoning) onto the surviving floor.
    survivor.mes = finalMessage.mes;
    survivor.extra ??= {};
    if (finalMessage.extra?.reasoning) {
        survivor.extra.reasoning = finalMessage.extra.reasoning;
        survivor.extra.reasoning_duration = finalMessage.extra.reasoning_duration;
    }
    if (Array.isArray(record) && record.length) {
        survivor.extra.tool_invocations = record;
    }

    // Keep the swipe list consistent with the new text.
    if (Array.isArray(survivor.swipes) && survivor.swipes.length) {
        const swipeId = Number(survivor.swipe_id ?? 0);
        if (swipeId >= 0 && swipeId < survivor.swipes.length) {
            survivor.swipes[swipeId] = finalMessage.mes;
        } else {
            survivor.swipes.push(finalMessage.mes);
            survivor.swipe_id = survivor.swipes.length - 1;
        }
    }

    // Replace the whole block with the survivor, keeping the same array reference.
    chat.splice(start, finalIndex - start + 1, survivor);

    document.querySelectorAll('#chat .mes').forEach(element => {
        const id = Number(element.getAttribute('mesid'));
        if (Number.isFinite(id) && id >= start) {
            element.remove();
        }
    });

    context.addOneMessage(survivor);
    context.saveChat();

    renderDelegationTrace(start);
    setTimeout(() => renderDelegationTrace(start), 50);

    console.debug(`[POV Agents] 已合并 ${finalIndex - start} 个中间楼层，正文保持在原楼层。`);
    return true;
}

let delegationFollowUpArmed = false;
let pendingInvocationRecord = null;

const TRACE_CLASS = 'pov-agent-trace';

/**
 * Injects the style for the collapsed delegation trace once.
 */
function injectTraceStyles() {
    if (document.getElementById('pov_agent_trace_style')) return;
    const style = document.createElement('style');
    style.id = 'pov_agent_trace_style';
    style.textContent = `
        .${TRACE_CLASS} {
            margin-top: 0.6em;
            border: 1px solid var(--SmartThemeBorderColor, #555);
            border-radius: 8px;
            padding: 4px 8px;
            background: var(--black30a, rgba(0, 0, 0, 0.3));
            font-size: calc(var(--mainFontSize, 15px) * 0.85);
            opacity: 0.9;
        }
        .${TRACE_CLASS} > summary {
            cursor: pointer;
            font-weight: bold;
            opacity: 0.85;
            outline: none;
        }
        .${TRACE_CLASS} .pov-trace-block {
            border-top: 1px dashed var(--SmartThemeBorderColor, #555);
            margin-top: 6px;
            padding-top: 4px;
        }
        .${TRACE_CLASS} pre {
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 40vh;
            overflow: auto;
            margin: 2px 0 6px 0;
            font-size: 0.95em;
        }
        .${TRACE_CLASS} .pov-trace-label { opacity: 0.8; }
        .${TRACE_CLASS} .pov-trace-out { color: var(--SmartThemeQuoteColor, inherit); }
    `;
    document.head.append(style);
}

/**
 * Renders (or removes) the collapsed "child agent trace" block inside a message.
 * It is appended to the message DOM only — never to `mes`, so it stays out of
 * the prompt and out of the chat structure.
 * @param {number|string} messageId Chat message index
 */
function renderDelegationTrace(messageId, force = false) {
    const context = getContext();
    const index = Number(messageId);
    let container = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (!container && index === context.chat.length - 1) {
        container = document.querySelector('#chat .mes:last-child');
    }
    if (!container) return;

    const existing = container.querySelector(`.${TRACE_CLASS}`);
    if (existing && !force) return;
    existing?.remove();

    if (!getSettings().showTrace) return;

    const invocations = context.chat[index]?.extra?.tool_invocations;
    if (!Array.isArray(invocations) || !invocations.length) return;

    const ours = invocations.filter(invocation => invocation.name === TOOL_NAME);
    if (!ours.length) return;

    injectTraceStyles();

    const details = document.createElement('details');
    details.className = TRACE_CLASS;

    const summary = document.createElement('summary');
    const target = describeDelegationTarget(ours);
    summary.textContent = `🎭 局部视角子代理调用详情（${ours.length} 次${target ? ` · ${target}` : ''}，点击展开）`;
    details.append(summary);

    for (const invocation of ours) {
        let params = invocation.parameters;
        if (typeof params === 'string') {
            try {
                params = JSON.parse(params);
            } catch {
                params = { task: params };
            }
        }

        const block = document.createElement('div');
        block.className = 'pov-trace-block';
        block.innerHTML = [
            '<div class="pov-trace-label"><b>→ task（给子代理的提问）</b></div>',
            `<pre>${escapeHtml(String(params?.task ?? ''))}</pre>`,
            '<div class="pov-trace-label"><b>→ context（给子代理的上下文）</b></div>',
            `<pre>${escapeHtml(String(params?.context ?? ''))}</pre>`,
            params?.role_instructions
                ? `<div class="pov-trace-label"><b>→ role_instructions（角色视角/边界）</b></div><pre>${escapeHtml(String(params.role_instructions))}</pre>`
                : '',
            '<div class="pov-trace-label pov-trace-out"><b>← 子代理返回</b></div>',
            `<pre class="pov-trace-out">${escapeHtml(String(invocation.result ?? ''))}</pre>`,
        ].join('');
        details.append(block);
    }

    // Mount next to .mes_text (not inside it): SillyTavern rewrites that node's
    // innerHTML while streaming/formatting, which would wipe the block.
    const host = container.querySelector('.mes_block') ?? container;
    host.append(details);
}

/**
 * Keeps the collapsed trace blocks mounted even if other extensions or the
 * streaming formatter rewrite the message DOM.
 */
function installTraceObserver() {
    const chat = document.getElementById('chat');
    if (!chat) {
        setTimeout(installTraceObserver, 1500);
        return;
    }

    let timer = null;
    const observer = new MutationObserver(() => {
        if (timer) return;
        timer = setTimeout(() => {
            timer = null;
            const total = getContext().chat.length;
            for (let i = 0; i < total; i++) {
                renderDelegationTrace(i);
            }
        }, 400);
    });

    observer.observe(chat, { childList: true, subtree: true });
}

/**
 * Pulls the "### 三条结论" section out of a child reply.
 * @param {string} text Child reply
 * @returns {string} Key-point section, or empty string
 */
function extractKeyPoints(text) {
    const match = String(text ?? '').match(/###\s*三条结论\s*\n([\s\S]*?)(?:\n#|$)/);
    return match ? match[1].trim() : '';
}

/**
 * Makes a short, human-readable label for what the child agent was asked about.
 * @param {object[]|null} invocations Invocation records
 * @returns {string} Short label
 */
function describeDelegationTarget(invocations) {
    if (!Array.isArray(invocations) || !invocations.length) return '';

    let params = invocations[0].parameters;
    if (typeof params === 'string') {
        try {
            params = JSON.parse(params);
        } catch {
            params = null;
        }
    }

    const text = String(params?.task ?? params?.role_instructions ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
}

globalThis.povAgentsBeforeGenerate = runPovAgentDirectorGuidance;

jQuery(() => {
    renderSettings();
    installInlineDelegation();
    installTraceObserver();

    const context = getContext();

    // Startup beacon: makes it obvious whether the browser is running the new code.
    if (getSettings().enabled) {
        console.log(`[POV Agents] loaded ${EXTENSION_VERSION} (pre-generation delegation, no SillyTavern tool calls)`);
        if (typeof toastr !== 'undefined') {
            toastr.info(`POV Agents 已加载 ${EXTENSION_VERSION}（生成前委派模式）`, 'POV Agents', { timeOut: 4000 });
        }
    }
    context.eventSource.on(context.eventTypes.GENERATION_ENDED, () => {
        if (!getSettings().enabled) return;
        console.debug('[POV Agents] 本轮生成结束。若上方没有“子代理结果已注入”的日志，说明导演判断本轮无需子代理。');
    });
});
