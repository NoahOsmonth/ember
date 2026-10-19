'use strict';

/**
 * The IPC contract: one list of channel names, kinds and payload schemas.
 *
 * The runtime registry (`src/main/index.js`) and the contract test both read
 * this list, so a channel cannot exist in one place and not the other. Handlers
 * stay in the main process; this file is only the declaration.
 *
 * @param {typeof import('../core/validate.js').v} v
 */
function channelSpecs(v) {
  const none = v.optional(v.object({}, { strict: true }));
  const settingsPatch = v.object({
    durations: v.optional(
      v.object({
        focus: v.number({ min: 1, max: 180, integer: true }),
        short: v.number({ min: 1, max: 60, integer: true }),
        long: v.number({ min: 1, max: 90, integer: true }),
      })
    ),
    rounds: v.optional(v.number({ min: 2, max: 6, integer: true })),
    autoBreak: v.optional(v.boolean()),
    autoFocus: v.optional(v.boolean()),
    sound: v.optional(v.boolean()),
    volume: v.optional(v.number({ min: 0, max: 1 })),
    notify: v.optional(v.boolean()),
    theme: v.optional(v.enum(['dusk', 'tide', 'solar', 'mono'])),
    opacity: v.optional(v.number({ min: 0.12, max: 0.96 })),
    mini: v.optional(v.boolean()),
    onTop: v.optional(v.boolean()),
    launch: v.optional(v.boolean()),
    x: v.optional(v.number({ integer: true })),
    y: v.optional(v.number({ integer: true })),
    tutorialSeen: v.optional(v.boolean()),
  });

  return [
    { name: 'state:get', kind: 'invoke', schema: none },
    { name: 'state:set', kind: 'invoke', schema: settingsPatch },
    { name: 'state:reset', kind: 'invoke', schema: none },
    { name: 'win:move', kind: 'send', schema: v.object({ dx: v.number(), dy: v.number() }) },
    { name: 'win:mini', kind: 'invoke', schema: v.object({ mini: v.boolean() }) },
    { name: 'win:lock', kind: 'invoke', schema: v.object({ locked: v.boolean() }) },
    { name: 'win:close', kind: 'send', schema: none },
    { name: 'app:quit', kind: 'send', schema: none },
    { name: 'menu:show', kind: 'send', schema: none },
    {
      name: 'settings:open',
      kind: 'invoke',
      schema: v.optional(
        v.object({ tab: v.optional(v.enum(['settings', 'tutorial'])) }, { strict: true })
      ),
    },
  ];
}

module.exports = { channelSpecs };
