/**
 * Redux Store Configuration
 *
 * Configures the Redux store with the auth reducer.
 * This store is consumed by the `useAuth` hook and can be extended
 * with additional slices as the application grows.
 *
 * @module store/index
 */

import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice';

export const makeStore = () => {
  return configureStore({
    reducer: {
      auth: authReducer,
    },
    devTools: process.env.NODE_ENV !== 'production',
  });
};

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
