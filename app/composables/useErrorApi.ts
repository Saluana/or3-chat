/**
 * Auto-importable re-exports of the error utility API (Task 1.3)
 * Plugin authors can now use: err, reportError, asAppError, isAppError, simpleRetry
 * NOTE: useErrorToasts is deprecated (shim still exported for legacy components)
 */
export {
    err,
    reportError,
    asAppError,
    isAppError,
    simpleRetry,
    useErrorToasts,
} from '../utils/errors';
