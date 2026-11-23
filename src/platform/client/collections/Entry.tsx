import { pinnedCollectionLinks } from '../../collections.mjs';
import { toCollectionUrl } from './model';

export default function CollectionEntry() {
    return <div className="cw-entry">
        <section className="cw-group" aria-labelledby="cw-entry-pins">
            <div className="cw-group-head"><h2 id="cw-entry-pins">常用收集</h2><span>公开 · 登录后填写</span></div>
            <div className="cw-card-grid">{pinnedCollectionLinks.map(({ id, title }) =>
                <a key={id} className="cw-card cw-entry-card" href={toCollectionUrl(id)}>
                    <span className="cw-card-title">{title}</span>
                </a>)}</div>
        </section>
    </div>;
}
