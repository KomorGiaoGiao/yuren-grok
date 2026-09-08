//! Compact left sidebar for the Codex-style persistent dashboard layout.
//!
//! Paints cwd/location, `[+ New]`, and a single-line session list into the
//! sidebar pane returned by [`super::layout::split_sidebar_main`].
//!
//! Overlay modals (location picker, shortcuts cheatsheet, worktree dialog) are
//! **not** painted here: they must cover the full frame. The caller that
//! composes sidebar + main should paint them over the full area after both
//! panes, the same way [`super::render::render_dashboard`] does when it owns
//! the whole frame.

use indexmap::IndexMap;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::Span;
use unicode_width::UnicodeWidthStr;

use super::layout::compute_sidebar_layout;
use super::render::cached_home;
use super::row::{DashboardRow, build_rows_with_roster, build_rows_with_workspace};
use super::state::{DashboardRowId, DashboardState, RowState};
use crate::app::agent::AgentId;
use crate::app::agent_view::AgentView;
use crate::render::line_utils::{truncate_line, truncate_str};
use crate::theme::Theme;

/// Show each spinner frame for this many animation ticks (matches `render.rs`).
const SPINNER_DIVISOR: u64 = 4;
/// Needs-input bullet blink period (matches `render.rs`).
const NEEDS_INPUT_BLINK_DIVISOR: u64 = 10;

/// Compact `[+ New]` label for the narrow sidebar (vs the full header's `[+ New Agent]`).
/// Clicking opens a folder picker first, then creates in the chosen directory.
const NEW_BUTTON_LABEL: &str = "[+ New…]";
const NEW_WORKTREE_BUTTON_LABEL: &str = "[+ Worktree…]";

/// Render the persistent left dashboard sidebar into `area` (the sidebar pane only).
///
/// Reuses the same row builders as [`super::render::render_dashboard`] and stores
/// hit-test rects on `state` (`location_hit`, `new_agent_button_hit`, `row_rects`)
/// so existing mouse handlers keep working.
///
/// Returns `None` (no caret in the sidebar; the main pane owns the cursor).
#[allow(clippy::too_many_arguments)]
pub fn render_dashboard_sidebar(
    buf: &mut Buffer,
    area: Rect,
    state: &mut DashboardState,
    agents: &IndexMap<AgentId, AgentView>,
    roster: &[crate::app::roster::RosterEntry],
    workspace_dashboard_enabled: bool,
    workspace_snapshot: Option<&xai_grok_dashboard_store::WorkspaceSnapshot>,
) -> Option<(u16, u16)> {
    let theme = Theme::current();
    state.last_area = area;

    buf.set_style(area, Style::default().bg(theme.bg_base));

    // Sidebar has no dispatch / peek / slash surfaces.
    state.dispatch_rect = None;
    state.peek_close_rect = None;
    state.peek_reply_rect = None;
    state.slash_dropdown_items_area = None;
    state.slash_dropdown_hit = Default::default();
    state.file_search_dropdown_items_area = None;
    state.upgrade_cta_hit.set(None);
    state.idle_overflow_rect = None;
    state.section_rects.clear();
    state.row_delete_rects.clear();

    let home = cached_home();
    let rows = if workspace_dashboard_enabled {
        workspace_snapshot
            .map(|snapshot| build_rows_with_workspace(agents, snapshot, home))
            .unwrap_or_default()
    } else {
        build_rows_with_roster(
            agents,
            &state.pinned,
            &state.reorder,
            state.grouping,
            &state.filter,
            home,
            roster,
        )
    };
    state.conversation_row_ids = if workspace_dashboard_enabled {
        Default::default()
    } else {
        roster
            .iter()
            .filter(|e| e.origin.kind == "conversation")
            .map(|e| e.session_id.clone())
            .collect()
    };
    state.reanchor_selection(&rows);

    let layout = compute_sidebar_layout(area);
    render_sidebar_location(buf, layout.location, &theme, state);
    render_sidebar_new_button(buf, layout.new_button, &theme, state);
    render_sidebar_list(buf, layout.list, &theme, &rows, state);
    render_sidebar_footer(buf, layout.footer, &theme, &rows);

    // Modals: painted by the full-frame caller (see module docs).
    None
}

fn render_sidebar_location(
    buf: &mut Buffer,
    area: Rect,
    theme: &Theme,
    state: &mut DashboardState,
) {
    state.location_hit.set(None);
    if area.area() == 0 {
        return;
    }
    buf.set_style(area, Style::default().bg(theme.bg_base));

    let mut location = crate::views::welcome::location_line_at(theme, &state.cwd);
    location
        .spans
        .insert(0, Span::styled(" ", Style::default().bg(theme.bg_base)));
    let mut location = truncate_line(location, area.width as usize);
    if state.location_hit.hovered {
        location.spans = underline_non_whitespace(std::mem::take(&mut location.spans));
    }
    let location_w = location.width() as u16;
    buf.set_line(area.x, area.y, &location, location_w.min(area.width));
    let hit_w = location_w.min(area.width);
    if hit_w > 0 {
        state.location_hit.set(Some(Rect {
            x: area.x,
            y: area.y,
            width: hit_w,
            height: 1,
        }));
    }
}

fn underline_non_whitespace(spans: Vec<Span<'static>>) -> Vec<Span<'static>> {
    spans
        .into_iter()
        .map(|span| {
            let style = span.style;
            let content = span.content.into_owned();
            let style = if content.chars().any(|c| !c.is_whitespace()) {
                style.add_modifier(Modifier::UNDERLINED)
            } else {
                style
            };
            Span::styled(content, style)
        })
        .collect()
}

fn render_sidebar_new_button(
    buf: &mut Buffer,
    area: Rect,
    theme: &Theme,
    state: &mut DashboardState,
) {
    state.new_agent_button_hit.set(None);
    if area.area() == 0 {
        return;
    }
    buf.set_style(area, Style::default().bg(theme.bg_base));

    let label: &str = if state.dispatch_worktree && state.cwd_has_git_ancestor {
        NEW_WORKTREE_BUTTON_LABEL
    } else {
        NEW_BUTTON_LABEL
    };
    let label_w = UnicodeWidthStr::width(label) as u16;
    if label_w == 0 || area.width == 0 {
        return;
    }
    let painted = truncate_str(label, area.width as usize);
    let painted_w = UnicodeWidthStr::width(painted.as_str()) as u16;
    let fg = if state.new_agent_button_focused {
        theme.accent_success
    } else if state.new_agent_button_hit.hovered {
        theme.text_primary
    } else {
        theme.gray
    };
    let style = Style::default()
        .fg(fg)
        .bg(theme.bg_base)
        .add_modifier(Modifier::BOLD);
    // 1-cell left inset so the button aligns under the location text.
    let x = area.x.saturating_add(1.min(area.width.saturating_sub(painted_w)));
    buf.set_string(x, area.y, painted, style);
    if painted_w > 0 {
        state.new_agent_button_hit.set(Some(Rect {
            x,
            y: area.y,
            width: painted_w,
            height: 1,
        }));
    }
}

fn render_sidebar_list(
    buf: &mut Buffer,
    area: Rect,
    theme: &Theme,
    rows: &[DashboardRow],
    state: &mut DashboardState,
) {
    state.row_rects.clear();
    if area.area() == 0 {
        return;
    }
    buf.set_style(area, Style::default().bg(theme.bg_base));

    // Flat compact list: one line per non-placeholder row (status dot + title).
    let compact: Vec<&DashboardRow> = rows.iter().filter(|r| !r.is_more_placeholder).collect();
    if compact.is_empty() {
        let hint = if state.filter.is_active() {
            " No matches"
        } else {
            " No sessions"
        };
        let trunc = truncate_str(hint, area.width as usize);
        buf.set_string(
            area.x,
            area.y,
            trunc,
            Style::default().fg(theme.gray_dim).bg(theme.bg_base),
        );
        return;
    }

    let viewport_h = area.height as usize;
    let selected_idx = compact.iter().position(|r| {
        state.selected.as_ref().is_some_and(|s| r.id == *s)
            || attached_matches(state.attached_agent, &r.id)
    });
    // Prefer the selected row for viewport snap; fall back to the attached row.
    let snap_idx = compact
        .iter()
        .position(|r| state.selected.as_ref().is_some_and(|s| r.id == *s))
        .or(selected_idx);
    let offset = state.clamp_viewport(snap_idx, viewport_h, compact.len());

    let mut y = area.y;
    for row in compact.iter().skip(offset).take(viewport_h) {
        if y >= area.y + area.height {
            break;
        }
        let line_rect = Rect {
            x: area.x,
            y,
            width: area.width,
            height: 1,
        };
        paint_sidebar_row(buf, line_rect, theme, row, state);
        state.row_rects.push((row.id.clone(), line_rect));
        y += 1;
    }
}

fn attached_matches(attached: Option<AgentId>, id: &DashboardRowId) -> bool {
    match (attached, id) {
        (Some(aid), DashboardRowId::TopLevel(id)) => *id == aid,
        _ => false,
    }
}

fn paint_sidebar_row(
    buf: &mut Buffer,
    rect: Rect,
    theme: &Theme,
    row: &DashboardRow,
    state: &DashboardState,
) {
    if rect.area() == 0 {
        return;
    }
    let selected = state.selected.as_ref().is_some_and(|s| *s == row.id);
    let hovered = state.hovered_row.as_ref().is_some_and(|h| *h == row.id);
    let attached = attached_matches(state.attached_agent, &row.id);
    // Hover uses bg_hover; selected/attached keep the stronger highlight.
    // When hover == base (some themes), fall back to a bold label so feedback remains visible.
    let bg = if selected || attached {
        theme.bg_highlight
    } else if hovered {
        theme.bg_hover
    } else {
        theme.bg_base
    };
    let hover_label_boost = hovered && !selected && !attached;

    let fill = " ".repeat(rect.width as usize);
    buf.set_string(rect.x, rect.y, &fill, Style::default().bg(bg));

    let marker = if selected || attached {
        crate::glyphs::selection_bar()
    } else {
        " "
    };
    let marker_w = UnicodeWidthStr::width(marker) as u16;
    let icon = sidebar_state_icon(row.state, state.spinner_tick);
    let icon_color = if row.state == RowState::NeedsInput {
        sidebar_needs_input_color(state.spinner_tick, theme)
    } else {
        sidebar_state_color(row.state, theme)
    };
    let icon_w = UnicodeWidthStr::width(icon) as u16;
    let indent = " ".repeat(row.indent as usize); // 1 col per indent level (compact)
    let indent_w = UnicodeWidthStr::width(indent.as_str()) as u16;

    let marker_fg = if selected || attached {
        theme.accent_user
    } else {
        theme.gray_dim
    };
    let mut cx = rect.x;
    if cx < rect.x + rect.width {
        buf.set_string(
            cx,
            rect.y,
            marker,
            Style::default()
                .fg(marker_fg)
                .bg(bg)
                .add_modifier(Modifier::BOLD),
        );
        cx = cx.saturating_add(marker_w);
    }
    // Gap after marker.
    if cx < rect.x + rect.width {
        buf.set_string(cx, rect.y, " ", Style::default().bg(bg));
        cx = cx.saturating_add(1);
    }
    if indent_w > 0 && cx < rect.x + rect.width {
        let avail = (rect.x + rect.width).saturating_sub(cx);
        let trunc_indent = truncate_str(&indent, avail as usize);
        buf.set_string(cx, rect.y, trunc_indent, Style::default().bg(bg));
        cx = cx.saturating_add(indent_w.min(avail));
    }
    if cx < rect.x + rect.width {
        buf.set_string(
            cx,
            rect.y,
            icon,
            Style::default().fg(icon_color).bg(bg),
        );
        cx = cx.saturating_add(icon_w);
    }
    // Gap after icon.
    if cx < rect.x + rect.width {
        buf.set_string(cx, rect.y, " ", Style::default().bg(bg));
        cx = cx.saturating_add(1);
    }
    if cx >= rect.x + rect.width {
        return;
    }
    let label_budget = (rect.x + rect.width).saturating_sub(cx);
    let label = truncate_str(&row.label, label_budget as usize);
    let label_fg = if attached && !selected {
        theme.accent_user
    } else {
        theme.text_primary
    };
    let mut label_style = Style::default().fg(label_fg).bg(bg);
    if hover_label_boost {
        label_style = label_style.add_modifier(Modifier::BOLD);
    }
    buf.set_string(cx, rect.y, label, label_style);
}

fn render_sidebar_footer(buf: &mut Buffer, area: Rect, theme: &Theme, rows: &[DashboardRow]) {
    if area.area() == 0 {
        return;
    }
    buf.set_style(area, Style::default().bg(theme.bg_base));
    let total = rows.iter().filter(|r| r.indent == 0 && !r.is_more_placeholder).count();
    let working = rows
        .iter()
        .filter(|r| r.indent == 0 && r.state == RowState::Working)
        .count();
    let label = if working > 0 {
        format!(" {total} · {working} working")
    } else {
        format!(" {total} sessions")
    };
    let trunc = truncate_str(&label, area.width as usize);
    buf.set_string(
        area.x,
        area.y,
        trunc,
        Style::default().fg(theme.gray_dim).bg(theme.bg_base),
    );
}

fn sidebar_state_icon(state: RowState, tick: u64) -> &'static str {
    match state {
        RowState::Working => {
            let frames = crate::glyphs::dot_spinner_frames();
            let i = (tick / SPINNER_DIVISOR) as usize % frames.len();
            frames[i]
        }
        RowState::Idle | RowState::Inactive => crate::glyphs::diamond_hollow(),
        RowState::NeedsInput | RowState::Completed | RowState::Failed => {
            crate::glyphs::diamond_filled()
        }
    }
}

fn sidebar_state_color(state: RowState, theme: &Theme) -> ratatui::style::Color {
    match state {
        RowState::Working => theme.accent_running,
        RowState::NeedsInput => theme.warning,
        RowState::Idle | RowState::Inactive => theme.gray_dim,
        RowState::Completed => theme.accent_success,
        RowState::Failed => theme.accent_error,
    }
}

fn sidebar_needs_input_color(tick: u64, theme: &Theme) -> ratatui::style::Color {
    let bright = (tick / NEEDS_INPUT_BLINK_DIVISOR).is_multiple_of(2);
    if bright {
        theme.warning
    } else {
        crate::render::color::blend_color(theme.bg_base, theme.warning, 0.5)
            .unwrap_or(theme.warning)
    }
}
