/**
 * ToolRegistry -- central registry for all AI Agent tools.
 *
 * Each tool is an object:
 * {
 *   name: string,                    // Unique tool identifier
 *   description: string,             // LLM-facing description of what it does
 *   parameters: {                    // JSON Schema for tool parameters
 *     type: 'object',
 *     properties: { ... },
 *     required: ['...'],
 *   },
 *   execute: (args, context) => any, // Async function that performs the work
 * }
 *
 * The registry produces the OpenAI tool format for API calls and
 * resolves tool execution by name.
 */
function createToolRegistry() {
  const tools = new Map();

  function register(tool) {
    if (!tool.name || typeof tool.name !== 'string') {
      throw new Error('Tool must have a string name');
    }
    if (tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    tools.set(tool.name, tool);
  }

  /**
   * Register multiple tools at once from an array.
   */
  function registerAll(toolArray) {
    for (const tool of toolArray) {
      register(tool);
    }
  }

  /**
   * Get the list of tools in OpenAI-compatible format
   * for passing to the chat completions API.
   */
  function getOpenAITools() {
    return Array.from(tools.values()).map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /**
   * Execute a tool by name with the given args.
   * @param {string} name - Tool name
   * @param {object} args - Tool arguments (validated against schema by LLM)
   * @param {object} context - { deps, userContext } passed to each tool
   * @returns {Promise<any>} Tool result
   */
  async function execute(name, args, context) {
    const tool = tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: "${name}"`);
    }
    return tool.execute(args, context);
  }

  /**
   * Check if a tool name exists in the registry.
   */
  function has(name) {
    return tools.has(name);
  }

  /**
   * Get all registered tool names.
   */
  function listTools() {
    return Array.from(tools.keys());
  }

  return {
    register,
    registerAll,
    getOpenAITools,
    execute,
    has,
    listTools,
  };
}

module.exports = { createToolRegistry };
