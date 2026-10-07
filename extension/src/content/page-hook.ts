// MAIN-world content script (see manifest). Must run at document_start, before LeetCode's app.
import { installPageHook } from '../leetcode/page-hook-core.js';

installPageHook(window);
