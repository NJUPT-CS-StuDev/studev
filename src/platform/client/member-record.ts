import { loadClasses } from '../../campus/world/data';
import { addDays, momentNow } from '../../campus/world/time';
import { childrenOf, isWithin, namedOrganizations, organization, organizationName, studentCenter } from '../organizations.mjs';
import { api, avatarImg, button, copy, el, errorText, labels, message, nicknameOf, q, type AcademicYear, type Membership, type OrganizationNode, type User } from './api';

const dialog = q<HTMLDialogElement>('[data-member-card-modal]');
const body = q('[data-member-card-body]');
const notice = q<HTMLElement>('[data-member-card-status]');
const unassigned = '暂未分配';

q('[data-member-card-close]').addEventListener('click', () => dialog.close());

export function valueButton(label: string, value: string, feedback: HTMLElement, empty = '—') {
    if (!value) return el('span', empty, 'p-muted');
    const control = button(value, () => copy(value, feedback, label), 'secondary record-value');
    control.setAttribute('aria-label', `复制${label} ${value}`);
    return control;
}

function choices(label: string, options: (string | { id: string; name: string })[], value: string, empty: string) {
    const control = el('select', undefined, 'p-input');
    control.setAttribute('aria-label', label);
    control.append(new Option(empty, ''), ...options.map(item => typeof item === 'string' ? new Option(item, item) : new Option(item.name, item.id)));
    control.value = value;
    return control;
}

function field(label: string, value: string, maxLength: number, multiline = false) {
    const control = multiline ? el('textarea', undefined, 'p-input') : el('input', undefined, 'p-input');
    control.setAttribute('aria-label', label);
    control.value = value;
    control.maxLength = maxLength;
    return control;
}

function dateField(label: string) {
    const wrapper = el('label', undefined, 'p-membership-date');
    const input = el('input', undefined, 'p-input');
    input.type = 'date';
    wrapper.append(el('span', label), input);
    return { wrapper, input };
}

export function periodFields() {
    const start = dateField('任职开始日期');
    const end = dateField('任职最后一天');
    function interval() {
        start.input.setCustomValidity('');
        end.input.setCustomValidity('');
        const startsOn = start.input.value;
        const endsOn = end.input.value;
        if (!startsOn && !endsOn) return {};
        if (!startsOn || !endsOn || endsOn < startsOn) {
            const invalid = !startsOn ? start.input : end.input;
            invalid.setCustomValidity(!startsOn || !endsOn ? '请填写任期的开始和结束日期。' : '结束日期须在开始日期当天或之后。');
            invalid.reportValidity();
            return null;
        }
        return { startsOn, endsBefore: addDays(endsOn, 1) };
    }
    const clearValidation = () => {
        start.input.setCustomValidity('');
        end.input.setCustomValidity('');
    };
    start.input.addEventListener('input', clearValidation);
    end.input.addEventListener('input', clearValidation);
    return { start, end, interval, clearValidation };
}

export function openMemberRecord(
    initial: User,
    editable: boolean,
    saved: (updated: User) => void,
    focusEdit: boolean,
    liveOrgs: OrganizationNode[] = [],
    canEditMemberships = editable,
    academicYear?: AcademicYear,
) {
    let user = initial;
    let editing: HTMLFormElement | undefined;
    let saving = false;
    let nameEdit: HTMLButtonElement;
    const orgs = liveOrgs.length ? liveOrgs : namedOrganizations;

    async function save(change: Record<string, unknown>, label: string) {
        const result = await api<{ user: User }>(`/admin/users/${encodeURIComponent(user.id)}`, { revision: user.revision, ...change });
        user = result.user;
        saved(user);
        if (dialog.open) {
            render();
            message(notice, `已保存${label}。`, 'success');
        }
    }

    async function submit(form: HTMLFormElement, action: () => Promise<void>) {
        if (saving) return;
        saving = true;
        const controls = Array.from(form.elements) as (HTMLInputElement | HTMLButtonElement)[];
        controls.forEach(control => { control.disabled = true; });
        try { await action(); }
        catch (error) { message(notice, errorText(error), 'error'); }
        finally {
            controls.forEach(control => { control.disabled = false; });
            saving = false;
        }
    }

    function membershipChange(row: Membership, change: Partial<Membership>) {
        return { memberships: user.memberships.map(item => item === row ? { ...item, ...change } : item) };
    }

    type Editor = { control: () => HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; change: (value: string) => Record<string, unknown> };
    function row(parent: HTMLElement, label: string, value: string, editor?: Editor, empty?: string) {
        const line = el('div', undefined, 'p-record-row');
        line.append(el('span', label, 'p-record-label'), valueButton(label, value, notice, empty));
        let edit: HTMLButtonElement | undefined;
        if (editable && editor) {
            edit = button('编辑', () => {
                if (saving) return;
                editing?.remove();
                const input = editor.control();
                const form = el('form', undefined, 'p-record-edit');
                const cancel = button('取消', () => { form.remove(); edit?.focus(); });
                const commit = el('button', '保存', 'p-button small');
                commit.type = 'submit';
                form.append(input, cancel, commit);
                form.addEventListener('submit', event => {
                    event.preventDefault();
                    const change = editor.change(input.value);
                    void submit(form, () => save(change, label));
                });
                editing = form;
                line.append(form);
                input.focus();
            }, 'secondary record-edit');
            edit.setAttribute('aria-label', `编辑${label}`);
            line.append(edit);
        }
        parent.append(line);
        return edit;
    }

    function putText(parent: HTMLElement, label: string, key: 'realName' | 'studentId' | 'nickname' | 'signature', max: number) {
        const value = key === 'nickname' ? nicknameOf(user) : user[key] || '';
        return row(parent, label, value, {
            control: () => {
                const input = field(label, value, max, key === 'signature');
                input.required = key === 'realName' || key === 'studentId';
                if (key === 'studentId' && input instanceof HTMLInputElement) input.pattern = '[A-Za-z0-9]{6,20}';
                return input;
            },
            change: value => ({ [key]: value }),
        });
    }

    function editPeriod(parent: HTMLElement, membership: Membership, ending: boolean) {
        if (saving || !membership.startsOn || !membership.endsBefore) return;
        editing?.remove();
        const form = el('form', undefined, 'p-record-edit p-appointment-editor');
        const { start, end, interval } = periodFields();
        start.input.value = membership.startsOn;
        end.input.value = ending ? momentNow().date : addDays(membership.endsBefore, -1);
        start.input.required = end.input.required = true;
        start.input.readOnly = ending;
        end.input.max = ending ? addDays(membership.endsBefore, -1) : '';
        const actions = el('div', undefined, 'p-actions');
        const saveButton = el('button', ending ? '确认结束' : '保存任期', 'p-button small');
        saveButton.type = 'submit';
        actions.append(button('取消', () => form.remove()), saveButton);
        form.append(start.wrapper, end.wrapper, actions);
        form.addEventListener('submit', event => {
            event.preventDefault();
            const value = interval();
            if (value) void submit(form, () => save(membershipChange(membership, value), '任期'));
        });
        editing = form;
        parent.append(form);
        (ending ? end : start).input.focus();
    }

    function showMemberships(parent: HTMLElement) {
        parent.append(el('h3', '组织与任职', 'p-section-heading'));
        const today = momentNow().date;
        const memberships = [...user.memberships].sort((a, b) => a.organizationName.localeCompare(b.organizationName, 'zh-CN') || (b.startsOn ?? '').localeCompare(a.startsOn ?? ''));
        for (const membership of memberships) {
            const org = organization(membership.organizationId, orgs);
            if (!org) continue;
            const section = el('section', undefined, 'p-record-organization');
            if (org.parentId) section.append(el('p', organizationName(org.parentId, orgs), 'p-record-parent p-muted'));
            section.append(el('h4', org.name));
            const dated = Boolean(membership.startsOn && membership.endsBefore);
            const inStudentCenter = isWithin(org.id, studentCenter.id, orgs);
            row(section, dated ? '任职' : '职务', membership.title, canEditMemberships ? {
                control: () => {
                    const select = choices('职务', [...new Set([...org.titles, membership.title].filter(Boolean))], membership.title, unassigned);
                    if (dated && inStudentCenter && membership.title) select.options[0]?.remove();
                    return select;
                },
                change: title => membershipChange(membership, {
                    title,
                    overseesOrganizationId: title ? membership.overseesOrganizationId : '',
                    ...(!dated && title && inStudentCenter && academicYear ? {
                        startsOn: academicYear.startsOn, endsBefore: academicYear.endsBefore,
                    } : {}),
                }),
            } : undefined, unassigned);
            const children = childrenOf(org.id, orgs);
            if (children.length && membership.title) row(section, '分管组织', organization(membership.overseesOrganizationId, orgs)?.name || '', canEditMemberships ? {
                control: () => choices('分管组织', children, membership.overseesOrganizationId, '无分管'),
                change: overseesOrganizationId => membershipChange(membership, { overseesOrganizationId }),
            } : undefined, '无分管');
            if (inStudentCenter) row(section, '名册顺序', membership.order === 999 ? '' : String(membership.order), canEditMemberships ? {
                control: () => {
                    const input = field('名册顺序', membership.order === 999 ? '' : String(membership.order), 4) as HTMLInputElement;
                    input.type = 'number'; input.min = '0'; input.max = '9999';
                    return input;
                },
                change: value => membershipChange(membership, { order: value ? Number(value) : 999 }),
            } : undefined, '默认');
            if (membership.startsOn && membership.endsBefore) {
                const period = `${membership.startsOn} 至 ${addDays(membership.endsBefore, -1)}`;
                row(section, '任期', period);
                if (canEditMemberships) {
                    const actions = el('div', undefined, 'p-actions p-appointment-actions');
                    actions.append(button('更正任期', () => editPeriod(section, membership, false), 'secondary record-edit'));
                    if (membership.startsOn <= today && today < addDays(membership.endsBefore, -1)) {
                        actions.append(button('结束任职', () => editPeriod(section, membership, true), 'secondary record-edit'));
                    }
                    section.append(actions);
                }
            } else if (canEditMemberships) section.append(button('移除归属', () => {
                if (saving) return;
                editing?.remove();
                const confirm = el('form', undefined, 'p-record-edit');
                editing = confirm;
                const remove = el('button', '确认移除', 'p-button danger small');
                remove.type = 'submit';
                confirm.append(el('span', org.name, 'p-muted'), button('取消', () => confirm.remove()), remove);
                confirm.addEventListener('submit', event => {
                    event.preventDefault();
                    void submit(confirm, () => save({ memberships: memberships.filter(item => item !== membership) }, '组织归属'));
                });
                section.append(confirm);
                remove.focus();
            }, 'secondary record-edit'));
            parent.append(section);
        }
        if (!memberships.length) parent.append(el('p', unassigned, 'p-record-empty p-muted'));
        if (canEditMemberships) parent.append(button('添加任职或归属', async () => {
            if (saving) return;
            const add = el('form', undefined, 'p-record-edit p-appointment-editor');
            editing?.remove();
            editing = add;
            const select = el('select', undefined, 'p-input');
            select.setAttribute('aria-label', '选择组织');
            select.append(new Option('选择组织', ''));
            select.required = true;
            const unbounded = (id: string) => memberships.some(row => row.organizationId === id && !row.startsOn && !row.endsBefore);
            for (const org of orgs) if (!unbounded(org.id)) {
                const depth = 'depth' in org ? (org as OrganizationNode).depth : 0;
                const prefix = depth > 0 ? `${'　'.repeat(depth)}└ ` : '';
                select.add(new Option(`${prefix}${org.name}`, org.id));
            }
            const title = choices('选择职务', [], '', unassigned);
            title.disabled = true;
            const { start, end, interval, clearValidation } = periodFields();
            const dates = el('div', undefined, 'p-appointment-period');
            dates.hidden = true;
            dates.append(start.wrapper, end.wrapper);
            const updateDates = () => {
                const needsPeriod = Boolean(title.value && isWithin(select.value, studentCenter.id, orgs));
                const retained = memberships.some(item => item.organizationId === select.value && item.startsOn && item.endsBefore);
                dates.hidden = !title.value && !retained;
                start.input.required = end.input.required = needsPeriod || retained;
                if (needsPeriod && academicYear && !start.input.value && !end.input.value) {
                    start.input.value = academicYear.startsOn;
                    end.input.value = addDays(academicYear.endsBefore, -1);
                }
                if (dates.hidden) start.input.value = end.input.value = '';
                clearValidation();
            };
            select.addEventListener('change', () => {
                const org = organization(select.value, orgs);
                title.replaceChildren(new Option(unassigned, ''), ...(org?.titles ?? []).map(value => new Option(value, value)));
                title.disabled = !org || !org.titles.length;
                start.input.value = end.input.value = '';
                updateDates();
            });
            title.addEventListener('change', updateDates);
            const commit = el('button', '添加', 'p-button small');
            commit.type = 'submit';
            const actions = el('div', undefined, 'p-actions');
            actions.append(button('取消', () => add.remove()), commit);
            add.append(select, title, dates, actions);
            parent.append(add);
            select.focus();
            add.addEventListener('submit', event => {
                event.preventDefault();
                const organizationId = select.value;
                const value = interval();
                if (value) void submit(add, () => save({ memberships: [...memberships, { organizationId, title: title.value, ...value }] }, title.value ? '任职' : '组织归属'));
            });
            try {
                const classes = await loadClasses();
                for (const klass of classes) {
                    const cid = 'class:' + klass.id;
                    if (orgs.some(o => o.id === cid) || unbounded(cid)) continue;
                    const org = organization(cid, orgs);
                    if (org) select.add(new Option(org.name, org.id));
                }
            } catch (error) { if (add.isConnected) message(notice, errorText(error), 'error'); }
        }, 'secondary record-edit'));
    }

    function render() {
        const head = el('div', undefined, 'p-record-heading');
        head.append(avatarImg({ realName: user.realName, nickname: user.nickname, avatarUrl: `/api/platform/members/${user.id}/avatar` }, { width: 52, className: 'p-member-avatar' }));
        const title = el('h2', user.realName || user.nickname);
        title.id = 'member-record-title';
        title.tabIndex = -1;
        head.append(title);
        const identity = el('div');
        nameEdit = putText(identity, '姓名', 'realName', 40)!;
        putText(identity, '学号', 'studentId', 20);
        row(identity, 'QQ 号', user.qq);
        row(identity, '联系邮箱', user.email);
        row(identity, '身份核验', user.identityVerified ? '已核验' : '待核验', {
            control: () => {
                const select = choices('身份核验', ['已核验', '待核验'], user.identityVerified ? '已核验' : '待核验', '');
                select.options[0]!.remove();
                return select;
            },
            change: value => ({ identityVerified: value === '已核验' }),
        });
        row(identity, '管理权限', labels[user.role] || user.role);
        const organizations = el('div');
        showMemberships(organizations);
        const publicCard = el('details', undefined, 'p-public-card');
        publicCard.open = body.querySelector<HTMLDetailsElement>('details')?.open ?? false;
        publicCard.append(el('summary', '公开名片'));
        putText(publicCard, '昵称', 'nickname', 40);
        putText(publicCard, '签名', 'signature', 120);
        body.replaceChildren(head, identity, organizations, publicCard);
    }

    render();
    message(notice);
    dialog.showModal();
    if (editable && focusEdit) nameEdit!.focus();
    else q<HTMLElement>('#member-record-title', body).focus();
}
