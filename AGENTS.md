<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep Tide's existing localStorage key and restore legacy records as School without rewriting their content; this preserves the user's current local data without a new paid service.
- Store the active category centrally and filter todos, meetings, tasks and analytics with the same helper; Focus stays global to preserve the existing timer.
- Native reminders run only after consent in one mounted scheduler, using absolute due dates and shared deduplication; no service worker or closed-app delivery is promised.
- Pre-optimize React and the UI libraries used by Tide together in Vite; late optimization must not split the React dispatcher between open-preview dependency graphs. Preserve the template's existing React deduplication.
- Study scoring and reporting are pure functions in study-engine; dated focus entries belong to the existing store, while notebook/routine history use a separate subscribed local store to preserve legacy records.
- Time boxing credits task progress only when its allocated timer expires; partial sessions record effort without completing tasks, and historical undated focus is never fabricated as weekly activity.
- PDF export is a client-triggered dynamic import; never import browser PDF dependencies into server handlers or route loaders.
