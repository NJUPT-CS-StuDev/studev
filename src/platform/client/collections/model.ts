import type { OrganizationNode, Role } from '../api';
import { deadlineReached, roundAcceptsSubmissions, selectCollectionRound } from '../../collections.mjs';
import type { CollectionCourse } from './CoursePicker';

export type TargetMode = 'open' | 'selected';
export type Status = 'draft' | 'published' | 'closed';
export type Policy = 'strict' | 'allow-late' | 'closed';
export type SubmissionStatus = 'uploading' | 'submitted' | 'late' | 'pending_review' | 'accepted' | 'rejected';
export type FieldType = 'text' | 'textarea' | 'select' | 'checkbox' | 'number' | 'date' | 'file';

export const collectionStatus = { draft: '草稿', collecting: '收集中', makeup: '补交中', expired: '已截止', closed: '已停止' };
export const submissionStatus: Record<SubmissionStatus | 'missing', string> = { uploading: '待完成', submitted: '已提交', late: '补交', pending_review: '待审核', accepted: '已通过', rejected: '已退回', missing: '未提交' };

export interface Field {
    id: string;
    type: FieldType;
    label: string;
    description?: string;
    required: boolean;
    options?: string[];
    maxLength?: number;
    min?: number;
    max?: number;
    maxFiles?: number;
    maxFileBytes?: number;
    extensions?: string[];
}

export interface RoundSummary {
    id: string;
    label: string;
    deadline: string;
    policy: Policy;
    fileCount?: number;
    submittedCount?: number;
    totalCount?: number;
    myStatus?: SubmissionStatus | 'missing' | null;
    open?: boolean;
}

export interface Round extends RoundSummary {
    fields: Field[];
    requireReview: boolean;
    allowEdit: boolean;
    maxPerUser: number;
    maxSubmissions: number;
    submissionMode: 'replace' | 'multiple';
}

export interface Issuer {
    organizationId: string;
    organizationName: string;
    orgShortName: string;
    name: string;
    title: string;
}

export interface IssuerOption { organizationId: string; title: string; label: string }
export interface Recipient { studentId: string; name: string; groupId?: string; groupLabel?: string }
export interface DirectoryPerson extends Recipient { organizationIds: string[] }
export interface Directory { organizations: OrganizationNode[]; scopeIds: string[]; people: DirectoryPerson[] }
export interface Viewer { id: string; role: Role; isStaff: boolean; canPublish: boolean }

export interface Item<CurrentRound extends RoundSummary = RoundSummary> {
    id: string;
    name: string;
    description: string;
    tags: string[];
    term: string;
    course: CollectionCourse | null;
    issuer: Issuer;
    visibility: 'public' | 'members';
    status: Status;
    targetMode: TargetMode;
    audienceOrganizationId?: string | null;
    showProgress?: boolean;
    canViewProgress?: boolean;
    publishedAt: string;
    updatedAt: string;
    revision: number;
    rounds: CurrentRound[];
    recipientCount: number;
    recipients?: Recipient[];
    canManage: boolean;
    inRecipients: boolean;
}

interface WorkspaceData {
    viewer: Viewer | null;
    serverTime: number;
}

export interface Catalog extends WorkspaceData {
    items: Item[];
    organizations: OrganizationNode[];
    issuerOptions: IssuerOption[];
}

export interface ProgressCounts {
    total: number | null;
    submitted: number;
    missing: number | null;
    late: number;
    records: number;
}
export interface ProgressGroup extends ProgressCounts { id: string; label: string }
export interface RoundProgress extends ProgressCounts {
    groups: ProgressGroup[];
    ownStatus: SubmissionStatus | 'missing' | null;
    ownLate: boolean;
}
export interface BoardRow { studentId: string; name: string; orgId?: string; orgLabel: string; statuses: Record<string, SubmissionStatus | 'missing'> }
export interface Detail extends WorkspaceData {
    item: Item<Round>;
    mySubmissions: Submission[];
    initialBoard?: { roundId: string; data: RoundBoardData };
}

export type BoardSubmission = Pick<Submission, 'id' | 'studentId' | 'studentName' | 'status' | 'submittedAt' | 'late'> &
    { hasFiles: boolean; personId?: string; complete?: boolean };
export interface RoundBoardData { items: BoardSubmission[]; board: BoardRow[]; progress: RoundProgress }

export interface BoardTableRow {
    id: string;
    studentId?: string;
    personId?: string;
    name: string;
    groupId: string;
    groupLabel: string;
    status: SubmissionStatus | 'missing';
    late: boolean;
    submissionId?: string;
    submittedAt?: string;
    expected: boolean;
    complete?: boolean;
    hasFiles?: boolean;
}

const boardOrder = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
export const studentKey = (id?: string) => (id || '').normalize('NFKC').trim().toUpperCase();

export function comparePeople(left: BoardTableRow, right: BoardTableRow) {
    return Number(!left.studentId) - Number(!right.studentId)
        || boardOrder.compare(studentKey(left.studentId), studentKey(right.studentId))
        || boardOrder.compare(left.name, right.name)
        || (right.submittedAt || '').localeCompare(left.submittedAt || '');
}

export function groupBoardRows(rows: BoardTableRow[]) {
    const groups = new Map<string, { id: string; label: string; rows: BoardTableRow[] }>();
    for (const row of rows) {
        const group = groups.get(row.groupId) ?? { id: row.groupId, label: row.groupLabel || '待核对', rows: [] };
        group.rows.push(row);
        groups.set(row.groupId, group);
    }
    return [...groups.values()].sort((left, right) => Number(!left.id) - Number(!right.id)
        || boardOrder.compare(left.label, right.label) || left.id.localeCompare(right.id));
}

export function matchesBoardFilter(row: { status: string; submissionId?: string; late: boolean }, filter: string) {
    if (filter === 'all') return true;
    if (filter === 'submitted') return !!row.submissionId && row.status !== 'missing' && row.status !== 'uploading';
    if (filter === 'late') return row.status !== 'missing' && row.late;
    return row.status === filter;
}

export interface SubmissionFile { id: string; fieldId: string; name: string; size: number; type: string }
export interface Submission {
    id: string;
    itemId: string;
    roundId: string;
    itemName?: string;
    roundLabel?: string;
    studentId?: string;
    studentName?: string;
    answers: Record<string, unknown>;
    fields: Field[];
    files: SubmissionFile[];
    submittedAt: string;
    status: SubmissionStatus;
    late: boolean;
    revision: number;
    review?: { status: string; comment: string };
}

export const itemRoute = (id: string) => `/collections/items/${encodeURIComponent(id)}`;
export const roundRoute = (id: string, round: string) => `${itemRoute(id)}/rounds/${encodeURIComponent(round)}`;
export const submissionRoute = (id: string) => `/collections/submissions/${encodeURIComponent(id)}`;

const dateTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' });
export function displayTime(value: string) {
    return value && Number.isFinite(Date.parse(value)) ? dateTime.format(new Date(value)) : '不限时';
}

export function deadlineInput(value: string) {
    if (!value) return '';
    const offset = 8 * 60 * 60 * 1000;
    return new Date(Date.parse(value) + offset).toISOString().slice(0, 16);
}

export function deadlineValue(value: string) {
    return value ? new Date(`${value}+08:00`).toISOString() : '';
}

export function roundState(item: Item, round: RoundSummary, now: number): keyof typeof collectionStatus {
    if (item.status !== 'published') return item.status;
    const expired = deadlineReached(round.deadline, now);
    if (roundAcceptsSubmissions(item, round, now)) return expired ? 'makeup' : 'collecting';
    return expired ? 'expired' : 'closed';
}

export function itemState(item: Item, now: number): keyof typeof collectionStatus {
    if (item.status !== 'published') return item.status;
    const states = item.rounds.map(round => roundState(item, round, now));
    if (states.includes('collecting')) return 'collecting';
    if (states.includes('makeup')) return 'makeup';
    return states.length && states.every(state => state === 'expired') ? 'expired' : 'closed';
}

export function chooseRound(item: Item<Round>, id: string) {
    return selectCollectionRound(item.rounds, id, round => round.open === true);
}

export function collectionLoginUrl(query = new URLSearchParams(location.search)) {
    const params = new URLSearchParams([...query].filter(([key]) => ['id', 'round', 'receipt', 'mine'].includes(key) || key.startsWith('a.')));
    return `/login/?next=${encodeURIComponent(`/forms/${params.size ? `?${params}` : ''}`)}`;
}

export function toCollectionUrl(item?: string, round?: string) {
    const query = new URLSearchParams();
    if (item) query.set('id', item);
    if (item && round) query.set('round', round);
    return `/forms/${query.size ? `?${query}` : ''}`;
}
