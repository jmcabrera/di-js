const {
  configure,
  logger,
  patchLoggerTags,
  fork,
  forkImmediate,
  fromScratch,
} = require('./substrate');

// Plugin a logger and a metrics implementation into the substrate.
// This must be done exactly once.
configure({
  logger: {
    debug: console.log.bind(null, 'DEBUG'),
    info: console.log.bind(null, 'INFO'),
    warn: console.log.bind(null, 'WARN'),
    error: console.log.bind(null, 'ERROR'),
  },
  metrics: {
    increment: console.log.bind(null, 'METRICS'),
  },
});

// Starting two conversations in parallel.
// Each will have its own substrate:
// From the substrate standing point, nothing done in one conversation
// should interfere with the other.
Promise.all([
  fromScratch(async () => conversation('😃')),
  fromScratch(async () => conversation('😈')),
]);

// Examplified with the logger, but works just the same with metrics as well.
async function conversation(mood) {
  // Add a tag for the logger. From now on, each log entry
  // will have this tag in this substrate.
  patchLoggerTags({ mood });

  logger().info(
    `every log entries will contain the tag mood ${mood}`,
  );

  // History of substrates diverge here, and will never reconcile.
  fork(() => {
    setTimeout(() => {
      patchLoggerTags({ tag_1: 'tag_1' });
      logger().info('With tag_1, but nothing else from below.');
    }, 10);
  });

  // This by contrast does not fork the substrates yet.
  // Later tags will bleed in ().
  setTimeout(() => {
    fork(() => {
      patchLoggerTags({ tag_3: 'tag_3' });
      logger().info('With tag_3, but also tag_2!!');
    }, 10);
  });

  logger().info(`this one does not have the tag_1`);

  // alias for fork(() => setImmediate(...))
  forkImmediate(() => logger().info('with mood only'));

  // By contrast, this call will exhibit tags placed _after_ in code.
  setImmediate(() => logger().info('no forking here, so this will have the tag_2!!'));

  patchLoggerTags({ tag_2: 'tag_2' });

  logger().info('with tag_2 only :)');
}
