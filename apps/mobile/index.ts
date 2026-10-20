import { createElement } from 'react';
import { registerRootComponent } from 'expo';
import { ErrorBoundary } from './src/ErrorBoundary';
import App from './App';

// Render errors show on screen (ErrorBoundary); fatal JS errors outside rendering reach the native crash screen
// (CrashActivity), which shows the error text instead of closing the app.
const Root = () => createElement(ErrorBoundary, null, createElement(App));
registerRootComponent(Root);
