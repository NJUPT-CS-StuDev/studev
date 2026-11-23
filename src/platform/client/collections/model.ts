import { roleLabels, type OrganizationNode } from '../api';
import type { CollectionCourse } from './CoursePicker';

export const viewLabels = { guest: '访客', ...roleLabels };
export type View = keyof typeof viewLabels;
export type TargetMode = 'open' | 'selected';
export type Status = 'draft' | 'published' | 'closed';
export type Policy = 'strict' | 'allow-late' | 'closed';
export type SubmissionStatus = 'uploading' | 'submitted' | 'late' | 'pending_review' | 'accepted' | 'rejected';
export type FieldType = 'text' | 'textarea' | 'select' | 'checkbox' | 'number' | 'date' | 'file';

export const collectionStatus: Record<Status, string> = { draft: '草稿', published: '收集中', closed: '已停止' };
export const submissionStatus: Record<SubmissionStatus | 'missing', string> = { uploading: '待完成', submitted: '已提交', late: '迟交', pending_review: '待审核', accepted: '已通过', rejected: '已退回', missing: '未提交' };

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
export interface Recipient { studentId: string; name: string }
export interface DirectoryPerson extends Recipient { organizationIds: string[] }
export interface Directory { organizations: OrganizationNode[]; people: DirectoryPerson[] }
export interface Viewer { id: string; role: Exclude<View, 'guest'>; view: View; isStaff: boolean; canPublish: boolean }

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
    publishedAt: string;
    updatedAt: string;
    revision: number;
    rounds: CurrentRound[];
    recipientCount: number;
    recipients?: Recipient[];
    canManage: boolean;
    inRecipients: boolean;
}

export interface WorkspaceView {
    viewer: Viewer | null;
    view: View;
    views: View[];
}

export interface Catalog extends WorkspaceView {
    items: Item[];
    organizations: OrganizationNode[];
    issuerOptions: IssuerOption[];
}

export interface RoundStats { roundId: string; total: number; submitted: number; late: number; missing: number }
export interface BoardRow { studentId: string; name: string; orgLabel: string; statuses: Record<string, SubmissionStatus | 'missing'> }
export interface Detail extends WorkspaceView {
    item: Item<Round>;
    mySubmissions: Submission[];
}

export interface RoundBoardData { items: Submission[]; board: BoardRow[]; roundStats: RoundStats[] }

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

export const roundIsOpen = (item: Item, round: RoundSummary) => item.status === 'published' && round.policy !== 'closed'
    && (!round.deadline || round.policy === 'allow-late' || Date.parse(round.deadline) > Date.now());

export function collectionLoginUrl(query = new URLSearchParams(location.search)) {
    const params = new URLSearchParams(query);
    params.delete('view');
    return `/login/?next=${encodeURIComponent(`/forms/${params.size ? `?${params}` : ''}`)}`;
}

export function toCollectionUrl(item?: string, round?: string, from = new URLSearchParams(location.search)) {
    const query = new URLSearchParams();
    const view = from.get('view');
    if (view) query.set('view', view);
    if (item) query.set('id', item);
    if (item && round) query.set('round', round);
    return `/forms/${query.size ? `?${query}` : ''}`;
}
