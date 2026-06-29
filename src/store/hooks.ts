/**
 * Typed Redux Hooks
 *
 * Pre-typed versions of `useDispatch` and `useSelector` for the
 * application store. Use these throughout the app instead of plain
 * `useDispatch` / `useSelector` to avoid manually annotating types.
 *
 * @module store/hooks
 */

import { useDispatch, useSelector, useStore } from 'react-redux';
import type { RootState, AppDispatch, AppStore } from './index';

/** Typed dispatch hook. Use this instead of `useDispatch`. */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();

/** Typed selector hook. Use this instead of `useSelector`. */
export const useAppSelector = useSelector.withTypes<RootState>();

/** Typed store hook. Use this when you need direct store access. */
export const useAppStore = useStore.withTypes<AppStore>();
