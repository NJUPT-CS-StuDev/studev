// The campus query product, one React island under /search/. It is rendered
// into the page at build time for its route and hydrated in the browser.
import App from '@/app/App';
import type { AppRoute } from '@/app/routing/useUrlState';
import './campus.css';

export default function CampusApp({ route }: { route: AppRoute }) {
    return <App initialRoute={route} />;
}
