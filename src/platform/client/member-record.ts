import { loadClasses } from '../../campus/world/data';
import { leadership, organization, studentCenter } from '../organizations.mjs';
import { api, avatarImg, button, copy, el, errorText, labels, message, nicknameOf, q, type Membership, type User } from './api';

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

function choices(label: string, options: string[], value: string, empty: string) {
    const control = el('select', undefined, 'p-input');
    control.setAttribute('aria-label', label);
    control.append(new Option(empty, ''), ...options.map(item => new Option(item, item)));
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

export function openMemberRecord(initial: User, editable: boolean, saved: (updated: User) => void, focusEdit: boolean) {
    let user = initial;
    let editing: HTMLFormElement | undefined;
    let saving = false;
    let nameEdit: HTMLButtonElement;

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
        return { memberships: user.memberships.map(item => item.organizationId === row.organizationId ? { ...item, ...change } : item) };
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

    function showMemberships(parent: HTMLElement) {
        parent.append(el('h3', '当前组织归属', 'p-section-heading'));
        const memberships = user.memberships || [];
        for (const membership of memberships) {
            const org = organization(membership.organizationId);
            if (!org) continue;
            const section = el('section', undefined, 'p-record-organization');
            section.append(el('h4', org.name));
            if (org.departments.length) row(section, '所属部门', membership.department, {
                control: () => choices('所属部门', org.departments, membership.department, unassigned),
                change: value => membershipChange(membership, { department: value }),
            }, unassigned);
            row(section, '现任职务', membership.title, {
                control: () => choices('现任职务', org.titles, membership.title, unassigned),
                change: title => membershipChange(membership, { title, responsibleDepartment: leadership(title) ? membership.responsibleDepartment : '' }),
            }, unassigned);
            if (org.departments.length && leadership(membership.title)) row(section, '分管部门', membership.responsibleDepartment, {
                control: () => choices('分管部门', org.departments, membership.responsibleDepartment, unassigned),
                change: value => membershipChange(membership, { responsibleDepartment: value }),
            }, unassigned);
            if (org.id === studentCenter.id) row(section, '名册顺序', membership.order === 999 ? '' : String(membership.order), {
                control: () => {
                    const input = field('名册顺序', membership.order === 999 ? '' : String(membership.order), 4) as HTMLInputElement;
                    input.type = 'number'; input.min = '0'; input.max = '9999';
                    return input;
                },
                change: value => membershipChange(membership, { order: value ? Number(value) : 999 }),
            }, '默认');
            if (editable) section.append(button('移除归属', () => {
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
        if (editable) parent.append(button('添加组织归属', async () => {
            if (saving) return;
            const add = el('form', undefined, 'p-record-edit');
            editing?.remove();
            editing = add;
            const select = el('select', undefined, 'p-input');
            select.setAttribute('aria-label', '选择组织');
            select.append(new Option('选择组织', ''));
            select.required = true;
            if (!memberships.some(row => row.organizationId === studentCenter.id)) select.add(new Option(studentCenter.name, studentCenter.id));
            const commit = el('button', '添加', 'p-button small');
            commit.type = 'submit';
            add.append(select, button('取消', () => add.remove()), commit);
            parent.append(add);
            select.focus();
            add.addEventListener('submit', event => {
                event.preventDefault();
                const organizationId = select.value;
                void submit(add, () => save({ memberships: [...memberships, { organizationId }] }, '组织归属'));
            });
            try {
                const classes = await loadClasses();
                for (const klass of classes) {
                    const org = organization('class:' + klass.id);
                    if (org && !memberships.some(row => row.organizationId === org.id)) select.add(new Option(org.name, org.id));
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
