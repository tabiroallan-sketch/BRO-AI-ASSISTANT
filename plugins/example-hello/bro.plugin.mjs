/**
 * Example BRO plugin (Milestone 14).
 *
 * A plugin is a directory (or single file) containing a `bro.plugin.js`,
 * `bro.plugin.mjs`, `bro.plugin.cjs`, or `bro.plugin.ts` file that exports a
 * plugin manifest. Drop the folder into the `plugins/` directory (or the
 * directory configured via `PLUGINS_DIR`) and restart the server — no core
 * code changes required. Changes can also be picked up at runtime with
 * `POST /api/v1/plugins/reload`.
 *
 * The manifest adds `tools` to the assistant's tool set, plus optional
 * `setup`/`teardown` lifecycle hooks. See the README "Plugin System" section
 * for the full authoring guide.
 *
 * @type {import('../../src/plugins/index.js').BroPlugin}
 */
export default {
  name: 'example-hello',
  version: '1.0.0',
  enabled: false,
  description: 'Adds a greeting tool and a startup log message.',
  author: 'BRO Team',
  setup(context) {
    context.log.info(`Example plugin loaded from ${context.basePath}`);
  },
  teardown(context) {
    context.log.info('Example plugin unloaded');
  },
  tools: [
    {
      name: 'greet',
      description: 'Return a friendly greeting. Useful for verifying plugins work.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The person to greet.',
          },
        },
        required: ['name'],
      },
      async execute(args) {
        const name = args.name;
        return `Hello, ${typeof name === 'string' && name ? name : 'world'}! (from the example plugin)`;
      },
    },
  ],
};
