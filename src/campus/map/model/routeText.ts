/** Route text is produced by the shared kernel from canonical IDs.  IDs stay
 * stable in data and URLs; the campus name is already known to the user and
 * must not leak into visible turn-by-turn text. */
export function visibleRouteText(text: string): string {
    return text.replaceAll('仙林/', '');
}
