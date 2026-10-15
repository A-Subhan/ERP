import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Page not found</div>
          <div className="page-subtitle">The page you requested does not exist.</div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-body">
          <p><Link to="/">Return to the overview.</Link></p>
        </div>
      </div>
    </div>
  );
}
