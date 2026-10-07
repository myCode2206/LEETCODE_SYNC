// MAIN-world content script (see manifest). Must run at document_start, before LeetCode's app.
import { installPageHook } from '../leetcode/page-hook-core.js';
import { log } from '../utils/log.js';

installPageHook(window, log);
log('page hook active on', location.pathname);
