import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorText } from '../api';
import { pinnedCollections, semesterLabel } from '../../collections.mjs';
import { DATA_RELEASE } from '@/world/config';
import { loadCalendar, type CalendarTerm } from '@/world/data';
import { momentNow } from '@/world/time';
import CoursePicker, { type CollectionCourse } from './CoursePicker';
import { Dialog } from './Dialog';
import { deadlineInput, deadlineValue, itemRoute, roundRoute, type Catalog, type Directory, type Field, type FieldType, type Item, type Round, type TargetMode } from './model';

export type EditorMode = 'create' | 'item' | 'recipients' | 'new-round' | 'round' | 'deadline';
const fieldLabels: Record<FieldType, string> = { text: '单行文字', textarea: '多行文字', select: '单选', checkbox: '多选', number: '数字', date: '日期', file: '附件' };
const titles: Record<EditorMode, string> = { create: '新建收集', item: '收集设置', recipients: '填写对象', 'new-round': '新增批次', round: '编辑批次', deadline: '截止时间' };
const defaultField = (): Field => ({ id: `f-${crypto.randomUUID().slice(0, 12)}`, type: 'text', label: '', required: true });
const draftRound = (label: string): Round => ({ id: '', label, deadline: '', policy: 'strict', fields: [defaultField()], requireReview: false, allowEdit: false, maxPerUser: 1, maxSubmissions: 500, submissionMode: 'replace' });
const lines = (raw: string) => raw.split(/[,，\n]/).map(value => value.trim()).filter(Boolean);
const MB = 1024 * 1024;
const semesterId = ({ number, start }: CalendarTerm) => {
    const year = Number(start.slice(0, 4)) - (number === 2 ? 1 : 0);
    return `${year}-${year + 1}-${number}`;
};

function RecipientPicker({ selected, onChange }: { selected: Map<string, string>; onChange: (value: Map<string, string>) => void }) {
    const [directory, setDirectory] = useState<Directory>();
    const [failure, setFailure] = useState('');
    const [attempt, retry] = useState(0);
    const [scope, setScope] = useState('');
    const [query, setQuery] = useState('');
    const [onlySelected, showOnlySelected] = useState(false);
    const [studentId, setStudentId] = useState('');
    const [name, setName] = useState('');
    const [page, setPage] = useState(1);
    useEffect(() => {
        let current = true;
        api<Directory>('/collections/people').then(value => { if (current) setDirectory(value); }).catch(error => { if (current) setFailure(errorText(error)); });
        return () => { current = false; };
    }, [attempt]);
    const parents = new Map(directory?.organizations.map(org => [org.id, org.parentId]));
    const belongs = (id: string) => {
        for (let node: string | null | undefined = id; node; node = parents.get(node)) {
            if (node === scope) return true;
        }
        return false;
    };
    const search = query.trim().normalize('NFKC').toLowerCase();
    const candidates = onlySelected ? [...selected].map(([studentId, name]) => ({ studentId, name, organizationIds: [] })) : directory?.people || [];
    const matches = candidates.filter(person => (onlySelected || !scope || person.organizationIds.some(belongs))
        && (!search || `${person.name} ${person.studentId}`.toLowerCase().includes(search)));
    const setPeople = (people: { studentId: string; name: string }[], checked: boolean) => {
        const next = new Map(selected);
        for (const person of people) {
            if (checked) next.set(person.studentId, person.name);
            else next.delete(person.studentId);
        }
        onChange(next);
    };
    const manualId = studentId.normalize('NFKC').trim().toUpperCase();
    const allSelected = matches.length > 0 && matches.every(person => selected.has(person.studentId));
    return <div className="cw-directory">
        <div className="cw-inline"><b>已选 {selected.size} 人</b><button type="button" className="cw-button" aria-pressed={onlySelected} onClick={() => { showOnlySelected(!onlySelected); setPage(1); }}>{onlySelected ? '查看组织名单' : '查看已选'}</button></div>
        <div className="cw-form-grid">{!onlySelected && <label>组织<select value={scope} onChange={event => { setScope(event.target.value); setPage(1); }}><option value="">所有可访问组织</option>{directory?.organizations.map(org => <option key={org.id} value={org.id}>{'　'.repeat(org.depth)}{org.name}</option>)}</select></label>}
            <label>搜索成员<input type="search" placeholder="学号或姓名" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label></div>
        {failure && <div className="cw-inline"><span role="alert">{failure}</span><button type="button" className="cw-button" onClick={() => { setFailure(''); retry(attempt + 1); }}>重试</button></div>}
        {matches.length > 0 ? <div className="cw-people">
            <label className="cw-check"><input type="checkbox" checked={allSelected} onChange={() => setPeople(matches, !allSelected)} />{onlySelected ? '移除所有匹配成员时取消勾选' : `选择匹配的 ${matches.length} 人`}</label>
            {matches.slice(0, page * 30).map(person => <label key={person.studentId} className="cw-check"><input type="checkbox" checked={selected.has(person.studentId)} onChange={event => setPeople([person], event.target.checked)} />{person.name}<span className="cw-mono cw-muted">{person.studentId}</span></label>)}
            {page * 30 < matches.length && <button type="button" className="cw-button" onClick={() => setPage(page + 1)}>显示更多</button>}
        </div> : <p className="cw-muted">{directory || onlySelected ? '未找到匹配成员' : failure ? '组织目录暂不可用' : '正在加载组织目录…'}</p>}
        <div className="cw-directory-add"><label>补充学号<input value={studentId} onChange={event => setStudentId(event.target.value)} /></label><label>姓名<input value={name} onChange={event => setName(event.target.value)} /></label>
            <button type="button" className="cw-button" disabled={!/^[A-Z0-9]{4,24}$/.test(manualId) || !name.trim()} onClick={() => { setPeople([{ studentId: manualId, name: name.trim() }], true); setStudentId(''); setName(''); }}>添加</button>
        </div>
    </div>;
}

function FieldsEditor({ fields, onChange }: { fields: Field[]; onChange: (value: Field[]) => void }) {
    const [optionText, setOptionText] = useState<Record<string, string>>({});
    const [extensionText, setExtensionText] = useState<Record<string, string>>({});
    const patch = (id: string, value: Partial<Field>) => onChange(fields.map(field => field.id === id ? { ...field, ...value } : field));
    return <div className="cw-fields-editor">
        {fields.map((field, index) => <fieldset key={field.id}>
            <legend>字段 {index + 1}</legend>
            <div className="cw-form-grid"><label>字段名称<input required maxLength={100} value={field.label} onChange={event => patch(field.id, { label: event.target.value })} /></label>
                <label>类型<select value={field.type} onChange={event => patch(field.id, { type: event.target.value as FieldType })}>{Object.entries(fieldLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
            <label>说明<input maxLength={500} value={field.description || ''} onChange={event => patch(field.id, { description: event.target.value })} /></label>
            {(field.type === 'select' || field.type === 'checkbox') && <label>选项（每行一个）<textarea required rows={3} value={optionText[field.id] ?? field.options?.join('\n') ?? ''} onChange={event => {
                const value = event.target.value;
                setOptionText({ ...optionText, [field.id]: value });
                patch(field.id, { options: value.split('\n').map(option => option.trim()).filter(Boolean) });
            }} /></label>}
            {(field.type === 'text' || field.type === 'textarea') && <label>最多字符<input type="number" min="1" max={field.type === 'text' ? 1000 : 10000} placeholder={field.type === 'text' ? '200' : '2000'} value={field.maxLength ?? ''} onChange={event => patch(field.id, { maxLength: event.target.value === '' ? undefined : +event.target.value })} /></label>}
            {field.type === 'number' && <div className="cw-form-grid"><label>最小值<input type="number" step="any" value={field.min ?? ''} onChange={event => patch(field.id, { min: event.target.value === '' ? undefined : +event.target.value })} /></label>
                <label>最大值<input type="number" step="any" value={field.max ?? ''} onChange={event => patch(field.id, { max: event.target.value === '' ? undefined : +event.target.value })} /></label></div>}
            {field.type === 'file' && <><div className="cw-form-grid"><label>附件上限（个）<input type="number" min="1" max="5" value={field.maxFiles || 1} onChange={event => patch(field.id, { maxFiles: +event.target.value })} /></label>
                <label>每个大小上限（MB）<input type="number" min="0.01" max="50" step="0.01" value={field.maxFileBytes === undefined ? 20 : +(field.maxFileBytes / MB).toFixed(2)} onChange={event => patch(field.id, { maxFileBytes: Math.round(+event.target.value * MB) })} /></label></div>
                <label>允许的扩展名<input placeholder="例如 pdf, docx, zip" value={extensionText[field.id] ?? field.extensions?.join(', ') ?? ''} onChange={event => {
                    const value = event.target.value;
                    setExtensionText({ ...extensionText, [field.id]: value });
                    patch(field.id, { extensions: lines(value).length ? lines(value) : undefined });
                }} /></label></>}
            <div className="cw-inline"><label className="cw-check"><input type="checkbox" checked={field.required} onChange={event => patch(field.id, { required: event.target.checked })} />必填</label>
                <button className="cw-icon" type="button" disabled={fields.length === 1} aria-label={`删除字段 ${index + 1}`} onClick={() => onChange(fields.filter(other => other.id !== field.id))}><Trash2 size={17} /></button></div>
        </fieldset>)}
        <button className="cw-button" type="button" disabled={fields.length >= 30} onClick={() => onChange([...fields, defaultField()])}><Plus size={16} />添加字段</button>
    </div>;
}

function Timing({ value, patch }: { value: Round; patch: (value: Partial<Round>) => void }) {
    return <div className="cw-form-grid"><label>截止时间（北京时间）<input type="datetime-local" value={deadlineInput(value.deadline)} onChange={event => patch({ deadline: deadlineValue(event.target.value) })} /></label>
        <label>提交规则<select value={value.policy} onChange={event => patch({ policy: event.target.value as Round['policy'] })}><option value="strict">到期停止</option><option value="allow-late">允许迟交</option><option value="closed">停止提交</option></select></label></div>;
}

export function CollectionEditor({ mode, catalog, item, currentRound, authorize, onClose, onSaved }: {
    mode: EditorMode; catalog?: Catalog; item?: Item<Round>; currentRound?: Round; authorize: () => Promise<void>; onClose: () => void; onSaved: (id: string, roundId?: string) => void;
}) {
    const creating = mode === 'create';
    const itemFields = creating || mode === 'item';
    const roundFields = creating || mode === 'new-round' || mode === 'round';
    const targetFields = creating || mode === 'recipients';
    const options = catalog?.issuerOptions || [];
    const [issuerChoice, setIssuerChoice] = useState(0);
    const [name, setName] = useState(item?.name || '');
    const [description, setDescription] = useState(item?.description || '');
    const [tags, setTags] = useState(item?.tags.join('，') || '');
    const [course, setCourse] = useState<CollectionCourse | null>(item?.course || null);
    const [term, setTerm] = useState(item?.term);
    const [calendar, setCalendar] = useState<CalendarTerm[]>([]);
    useEffect(() => {
        if (!itemFields) return;
        let current = true;
        loadCalendar().then(terms => { if (current) setCalendar(terms); }).catch(() => {});
        return () => { current = false; };
    }, [itemFields]);
    const today = momentNow().date;
    const active = calendar.find(value => value.start <= today && today <= (value.break?.end || value.end));
    const selectedTerm = term ?? (active ? semesterId(active) : DATA_RELEASE.teaching);
    const semesters = [...new Set([selectedTerm, DATA_RELEASE.teaching, ...calendar.map(semesterId), ...catalog?.items.map(value => value.term) || []])].sort().reverse();
    const pinned = !!item && pinnedCollections.includes(item.id);
    const [visibility, setVisibility] = useState<Item['visibility']>(item?.visibility || 'members');
    const [status, setStatus] = useState<Item['status']>(item?.status || 'draft');
    const [targetMode, setTarget] = useState<TargetMode>(item?.targetMode || 'open');
    const [recipients, setRecipients] = useState(() => new Map((item?.recipients || []).map(person => [person.studentId, person.name])));
    const [round, setRound] = useState(() => currentRound && mode !== 'new-round' ? currentRound : draftRound(mode === 'new-round' ? `第 ${(item?.rounds.length || 0) + 1} 批` : '填写'));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const changeRound = (value: Partial<Round>) => setRound(previous => ({ ...previous, ...value }));
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
        const targets = { targetMode, recipients: targetMode === 'selected' ? [...recipients].map(([studentId, name]) => ({ studentId, name })) : [] };
        const details = { name, description, tags: lines(tags), course, term: selectedTerm, visibility };
        const roundBody = { label: round.label, deadline: round.deadline, policy: round.policy, fields: round.fields, requireReview: round.requireReview, allowEdit: round.allowEdit, maxPerUser: round.maxPerUser, maxSubmissions: round.maxSubmissions, submissionMode: round.submissionMode };
        setError('');
        setBusy(true);
        try {
            await authorize();
            if (creating) {
                const issuer = options[issuerChoice];
                if (!issuer) throw new Error('请选择发布身份。');
                const result = await api<{ item: Item<Round> }>('/collections/items', { ...details, ...targets, status: action === 'publish' ? 'published' : 'draft', issuerOrganizationId: issuer.organizationId, issuerTitle: issuer.title, rounds: [roundBody] });
                onSaved(result.item.id);
            } else if (item) {
                if (mode === 'new-round') {
                    const result = await api<{ item: Item<Round> }>(`${itemRoute(item.id)}/rounds`, { ...roundBody, revision: item.revision });
                    onSaved(item.id, result.item.rounds.at(-1)?.id);
                } else {
                    const roundEdit = mode === 'round' || mode === 'deadline';
                    const path = roundEdit ? roundRoute(item.id, round.id) : itemRoute(item.id);
                    const body = mode === 'round' ? roundBody : mode === 'deadline' ? { deadline: round.deadline, policy: round.policy } : mode === 'recipients' ? targets : { ...details, status };
                    await api(path, { ...body, revision: item.revision });
                    onSaved(item.id, currentRound?.id);
                }
            }
        } catch (failure) { setError(errorText(failure)); }
        finally { setBusy(false); }
    }
    return <Dialog title={titles[mode]} onClose={onClose} busy={busy} wide={creating || mode === 'round' || mode === 'new-round'}>
        <form className="cw-dialog-form" onSubmit={save}>
            {itemFields && <>
                {creating && <label>发布身份<select value={issuerChoice} onChange={event => setIssuerChoice(+event.target.value)}>{options.map((option, index) => <option key={`${option.organizationId}:${option.title}`} value={index}>{option.label}</option>)}</select></label>}
                <label>名称<input autoFocus required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
                <label>填写说明<textarea rows={3} maxLength={5000} value={description} onChange={event => setDescription(event.target.value)} /></label>
                <label>标签<input placeholder="例如 实验报告、活动报名" value={tags} onChange={event => setTags(event.target.value)} /></label>
                <div className="cw-form-grid"><label>学期<select required value={selectedTerm} onChange={event => setTerm(event.target.value)}>{semesters.map(id => <option key={id} value={id}>{semesterLabel(id)}</option>)}</select></label>
                    <label>可见范围<select value={visibility} disabled={pinned} onChange={event => setVisibility(event.target.value as Item['visibility'])}><option value="members">登录用户</option><option value="public">公开</option></select></label></div>
                <CoursePicker value={course} onChange={setCourse} />
                {!creating && <label>收集状态<select value={status} onChange={event => setStatus(event.target.value as Item['status'])}>{item?.status === 'draft' && <option value="draft">草稿</option>}<option value="published">收集中</option>{item?.status !== 'draft' && <option value="closed">停止收集</option>}</select></label>}
            </>}
            {targetFields && <>
                <label>填写对象<select value={targetMode} onChange={event => setTarget(event.target.value as TargetMode)}><option value="open">所有具有访问权限的人</option><option value="selected">指定成员</option></select></label>
                {targetMode === 'selected' && <RecipientPicker selected={recipients} onChange={setRecipients} />}
            </>}
            {(roundFields || mode === 'deadline') && <>
                {roundFields && <><h3>批次设置</h3><label>批次名称<input required maxLength={80} value={round.label} onChange={event => changeRound({ label: event.target.value })} /></label></>}
                <Timing value={round} patch={changeRound} />
                {roundFields && <><div className="cw-form-grid"><label>每人提交方式<select value={round.submissionMode} onChange={event => changeRound({ submissionMode: event.target.value as Round['submissionMode'] })}><option value="replace">保留一份</option><option value="multiple">可提交多份</option></select></label>
                    {round.submissionMode === 'multiple' && <label>每人最多提交<input type="number" min="1" max="20" required value={round.maxPerUser} onChange={event => changeRound({ maxPerUser: +event.target.value })} /></label>}
                    <label>本批次最多提交<input type="number" min="1" max="1000" required value={round.maxSubmissions} onChange={event => changeRound({ maxSubmissions: +event.target.value })} /></label></div>
                    <div className="cw-inline"><label className="cw-check"><input type="checkbox" checked={round.requireReview} onChange={event => changeRound({ requireReview: event.target.checked })} />提交后需要审核</label>
                    <label className="cw-check"><input type="checkbox" checked={round.allowEdit} onChange={event => changeRound({ allowEdit: event.target.checked })} />允许修改已答内容</label></div>
                    <FieldsEditor fields={round.fields} onChange={fields => changeRound({ fields })} /></>}
            </>}
            {error && <p className="cw-failure" role="alert">{error}</p>}
            <div className="cw-dialog-actions"><button className="cw-button" type="button" disabled={busy} onClick={onClose}>取消</button>
                {creating && <button className="cw-button" type="submit" value="draft" disabled={busy}>保存草稿</button>}
                <button className="cw-button cw-primary" type="submit" value="publish" disabled={busy}>{busy ? '正在保存…' : creating ? '发布收集' : '保存'}</button>
            </div>
        </form>
    </Dialog>;
}
