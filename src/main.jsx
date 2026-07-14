import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import '../styles.css';
import './phase3.css';
import ViewerApp from './ViewerApp.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ViewerApp />
  </React.StrictMode>,
);
