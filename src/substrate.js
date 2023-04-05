/**
 * @module substrate
 */
/**
 */
/**
 * @typedef {string | number | boolean | Values[] | CV} SimpleValues
 * @template {CoumpoundValues=CoumpoundValues} CV 
 */
/**
 * @typedef {{[keys:string]: SimpleValues<CV>}} CoumpoundValues
 * @template {CoumpoundValues=CoumpoundValues} CV 
 */
/** @typedef {CoumpoundValues<Configs>} Configs */
/** @typedef {CoumpoundValues} Extras */
/** @typedef {CoumpoundValues} Tags */
/** @typedef {(tags: Tags) => Tags | Tags} TagPatch */
/**
 * @typedef {Object} LoggerProvider
 * @property {(msg: string, extras: Extras = {}) => void} debug
 * @property {(msg: string, extras: Extras = {}) => void} info
 * @property {(msg: string, extras: Extras = {}) => void} warn
 * @property {(msg: string, extras: Extras = {}) => void} error
 */
/**
 * @typedef {Object} MetricsProvider
 * @property {(metric: string, extras: Extras = {}) => void} increment
 */
/**
 * @typedef {Object} StaticState
 * @property {LoggerProvider} logger
 * @property {MetricsProvider} metrics
 */
/**
 * @typedef {{[keys:string]: Values}} Config
 */

const { AsyncLocalStorage } = require('node:async_hooks');

class ImmutableTags {
  tags;

  /** @param {Tags} [tags]*/
  constructor(tags) {
    this.tags = Object.freeze(tags || {});
  }

  /**
   * @param {TagPatch} [patch]
   * @returns {ImmutableTags}
   */
  patch(patch) {
    let newTags;
    switch (typeof patch) {
      case 'function':
        newTags = patch(this.tags);
        break;
      case 'object':
        newTags = {
          ...this.tags,
          ...patch,
        };
        break;
      case 'undefined':
        newTags = this.tags;
        break;
      default:
        throw Error(
          'Tags should be patched with either a function or an object',
        );
    }
    return new ImmutableTags(newTags);
  }
}

class TaggedLogger {
  #tags;
  #impl;

  /**
   * @param {LoggerProvider} impl
   * @param {ImmutableTags} [tags]
   */
  constructor(impl, tags) {
    this.#impl = impl;
    this.#tags = tags ?? new ImmutableTags();
  }
  #decorate(msg, extras, action) {
    const log = {
      ...this.#tags.tags,
      msg,
    };
    if (extras != null) {
      log.extras = extras;
    }
    action(log);
  }

  /**
   * @param {TagPatch} [patch]
   * @returns
   */
  _fork(patch) {
    return new this.constructor(this.#impl, this.#tags.patch(patch));
  }

  /**
   * @param {string} msg
   * @param {Extras} extras
   */
  info(msg, extras) {
    this.#decorate(msg, extras, this.#impl.info);
  }
  /**
   * @param {string} msg
   * @param {Extras} extras
   */
  error(msg, extras) {
    this.#decorate(msg, extras, this.#impl.error);
  }
}

class TaggedMetrics {
  #tags;
  #impl;
  /**
   * @param {LoggerProvider} impl
   * @param {ImmutableTags} [tags]
   */
  constructor(impl, tags) {
    this.#impl = impl;
    this.#tags = tags ?? new ImmutableTags();
  }
  /**
   * @param {TagPatch} [patch]
   * @returns
   */
  _fork(patch) {
    return new this.constructor(this.#impl, this.#tags.patch(patch));
  }

  #decorate(counter, extras, action) {
    const metric = {
      counter,
      tags: {
        ...this.#tags.tags,
        ...extras,
      },
    };
    action(metric);
  }

  /**
   * @type {(counter: string, extras:Extras) => void}
   */
  increment(counter, extras) {
    this.#decorate(counter, extras, this.#impl.increment);
  }
}

class ScopedConfigs {
  #configs;
  /**
   *
   * @param {Configs} configs
   */
  constructor(configs) {
    this.#configs = Object.freeze(configs);
  }

  /**
   * @param {Config => Config)} filter
   * @returns {ScopedConfigs}
   */
  filter = (filter) => new ScopedConfigs(filter(this.#configs));
}

class Substrate {
  #logger;
  #metrics;

  /**
   * @param {LoggerProvider} loggerProvider
   * @param {MetricsProvider} metricsProvider
   */
  constructor(loggerProvider, metricsProvider) {
    this.#logger = new TaggedLogger(loggerProvider);
    this.#metrics = new TaggedMetrics(metricsProvider);
  }

  get logger() {
    return this.#logger;
  }
  get metrics() {
    return this.#metrics;
  }

  forkLogger(additionalTags) {
    this.#logger = this.#logger._fork(additionalTags);
    return this;
  }

  forkMetrics(additionalTags) {
    this.#metrics = this.#metrics._fork(additionalTags);
    return this;
  }

  fork() {
    const s = new Substrate();
    s.#logger = this.#logger._fork();
    s.#metrics = this.#metrics._fork();
    return s;
  }
}

/** @type {StaticState} */
let staticState;

/**
 *
 * @param {{logger: LoggerProvider, metrics: MetricsProvider}}} param0
 */
module.exports.configure = ({ logger, metrics }) => {
  if (staticState) {
    throw new Error('Cannot configure the substrate twice.');
  }
  staticState = {
    storage: new AsyncLocalStorage(),
    logger,
    metrics,
  };
};

/** @type {() => AsyncLocalStorage<Substrate>}  */
const storage = () => {
  if (staticState) {
    return staticState.storage;
  } else {
    throw new Error(
      'Substrat must be configured before being used. Call #configure prior to using this.',
    );
  }
};

const get = () => storage().getStore();

/**
 * Inherits a substrate if one is in place, or create a brand new one.
 * Any substrate in place when this is called is disregarded.
 * @type {(fn: () => void) => void} the actual action to execute
 */
module.exports.inherit = (fn) =>
  storage().run(
    get() || new Substrate(staticState.logger, staticState.metrics),
    fn,
  );

/**
 * Executes fn in the context of a brand new Substrate.
 * Any substrate in place when this is called is disregarded.
 * @type {(fn: () => void) => void} the actual action to execute
 */
module.exports.fromScratch = (fn) =>
  storage().run(new Substrate(staticState.logger, staticState.metrics), fn);

/**
 * Executes fn in the context of a new Substrate copied from the one currently in place, if any.
 * This means that the Substrate S starts with the same state as the one in place O.
 * No changes done to S (resp. O) will reflect back to S (resp. O), and vice-versa.
 * If no Substrate is in place, we start from a brand new, pristine Substrate: this call is therefore equivalent to
 * a call to fromScratch.
 * @type {(fn: () => void) => void} the actual action to execute
 */
module.exports.fork = (fn) => storage().run(get().fork(), fn);

/**
 * convenience: Forks the current substrat and execute the action in a timeout.
 * Equivalent to <pre>fork(() => setTimeout(fn,timeout))</pre>
 * @type {(fn: () => void, timeout: number) => void} the actual action to execute
 */
module.exports.forkTimeout = (fn, timeout) =>
  this.fork(() => setTimeout(fn, timeout));

/**
 * convenience: Forks the current substrat and execute the action in an Immediate.
 * Equivalent to <pre>fork(() => setImmediate(fn))</pre>.
 *
 * @type {(fn: () => void) => void} the actual action to execute
 */
module.exports.forkImmediate = (fn, timeout) =>
  this.fork(() => setImmediate(fn));

/**
 * Gives access to the Logger object, which will automatically get
 * the logger tags (see {@link module:substrate~patchLoggerTags}).
 *
 * @type {() => Logger}
 */
module.exports.logger = () => get().logger;

/**
 * Gives access to the Metrics object, which will automatically get
 * the metric tags (see #patchMetricsTags).
 * @type {() => TaggedMetrics}
 */
module.exports.metrics = () => get().metrics;

/**
 * Updates the tags associated with the logger of this substrate.
 * Can be passed either a set of tags that will be overlaid on the existing ones,
 * or a function that will be called with the existing set of tags as parameter,
 * and whose return will be the new set of tags.
 * @type {(Tags | ((tags: Tags) => Tags)) => void} patch
 */
module.exports.patchLoggerTags = (patch) => get().forkLogger(patch);

/**
 * Updates the tags associated with the metrics of this substrate.
 * Can be passed either a set of tags that will be overlaid on the existing ones,
 * or a function that will be called with the existing set of tags as parameter,
 * and whose return will be the new set of tags.
 * @type {(Tags | ((tags: Tags) => Tags)) => void} patch
 */
module.exports.patchMetricsTags = (patch) => get().forkMetrics(patch);
