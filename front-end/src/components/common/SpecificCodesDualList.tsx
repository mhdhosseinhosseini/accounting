import React, { useMemo, useState } from 'react';
import { Box, IconButton, List, ListItem, ListItemText, Paper, Tooltip, Typography, ListItemButton } from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SearchableSelect, { SelectableOption } from './SearchableSelect';
import { useTranslation } from 'react-i18next';

/**
 * SpecificCodesDualList
 * A dual-list selector tailored for choosing multiple "specific codes".
 * Left side: a searchable select (same component used in DocumentForm).
 * Middle: action arrows to add/remove.
 * Right side: the current list of selected codes; click an item then press remove.
 * - Props accept `options` with id/code/title and an optional `name` used in search labels.
 * - Emits selected id list via `onChange`.
 */
export interface DualListOption extends SelectableOption {
  id: string | number;
  name: string; // `${code} — ${title}`
  code: string;
  title: string;
}

interface SpecificCodesDualListProps {
  options: DualListOption[];
  selectedIds: (string | number)[];
  onChange: (ids: (string | number)[]) => void;
  leftLabel: string;
  rightLabel: string;
  placeholder?: string;
}

const SpecificCodesDualList: React.FC<SpecificCodesDualListProps> = ({
  options,
  selectedIds,
  onChange,
  leftLabel,
  rightLabel,
  placeholder,
}) => {
  const { i18n, t } = useTranslation();
  const isRTL = i18n.language === 'fa';

  // Current selection on the left (to be added)
  const [leftSelected, setLeftSelected] = useState<DualListOption | null>(null);
  // Current selection on the right (to be removed)
  const [rightSelectedId, setRightSelectedId] = useState<string | number | null>(null);

  /**
   * selectedItems
   * Derives the option objects for the selected ids.
   */
  const selectedItems: DualListOption[] = useMemo(() => {
    const set = new Set(selectedIds.map(String));
    return options.filter((o) => set.has(String(o.id)));
  }, [options, selectedIds]);

  /**
   * handleAdd
   * Adds the `leftSelected` option id to the selected list if not present.
   */
  function handleAdd(): void {
    if (!leftSelected) return;
    const id = leftSelected.id;
    const exists = selectedIds.some((sid) => String(sid) === String(id));
    if (exists) return;
    onChange([...selectedIds, id]);
    setLeftSelected(null);
  }

  /**
   * handleRemove
   * Removes the currently selected id from the right list if present.
   */
  function handleRemove(): void {
    if (rightSelectedId == null) return;
    const next = selectedIds.filter((sid) => String(sid) !== String(rightSelectedId));
    onChange(next);
    setRightSelectedId(null);
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '0.7fr 36px 1.3fr', gap: 1, alignItems: 'start' }}>
      {/* Left: Searchable select */}
      <Box>
        <SearchableSelect<DualListOption>
          options={options}
          value={leftSelected}
          onChange={(opt) => setLeftSelected(opt)}
          label={leftLabel}
          placeholder={placeholder}
          size="small"
          fullWidth
          getOptionLabel={(opt) => opt.name}
          isOptionEqualToValue={(o, v) => String(o.id) === String(v.id)}
          openOnFocus
        />
      </Box>

      {/* Middle: arrows */}
      <Box sx={{ width: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, pt: 0.5 }}>
        <Tooltip title={t('actions.addToList', isRTL ? 'افزودن به فهرست' : 'Add to list')}>
          <span>
            <IconButton
              color="success"
              onClick={handleAdd}
              disabled={!leftSelected}
              aria-label={t('actions.addToList', isRTL ? 'افزودن به فهرست' : 'Add to list')}
              size="small"
            >
              {/* Add action: plus icon, green */}
              <AddCircleOutlineIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t('actions.removeFromList', isRTL ? 'حذف از فهرست' : 'Remove from list')}>
          <span>
            <IconButton
              color="error"
              onClick={handleRemove}
              disabled={rightSelectedId == null}
              aria-label={t('actions.removeFromList', isRTL ? 'حذف از فهرست' : 'Remove from list')}
              size="small"
            >
              {/* Remove action: trash icon, red */}
              <DeleteOutlineIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* Right: selected list */}
      <Paper variant="outlined" sx={{ p: 1 }}>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            mb: 1,
            bgcolor: 'grey.100',
            color: 'text.primary',
            px: 1,
            py: 0.5,
            borderRadius: 0.5,
          }}
        >
          {rightLabel}
        </Typography>
        <List dense sx={{ maxHeight: 180, overflowY: 'auto' }}>
          {selectedItems.length === 0 && (
            <ListItem>
              <ListItemText primary={t('labels.none', isRTL ? 'هیچ' : 'None')} />
            </ListItem>
          )}
          {selectedItems.map((opt) => {
            const active = String(rightSelectedId) === String(opt.id);
            return (
              <ListItem key={String(opt.id)} disablePadding>
                <ListItemButton
                  onClick={() => setRightSelectedId(opt.id)}
                  selected={active}
                  sx={{ borderRadius: 0.75, mb: 0.5 }}
                >
                  <ListItemText
                    primary={`${opt.code} — ${opt.title}`}
                    primaryTypographyProps={{ noWrap: true }}
                  />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </Paper>
    </Box>
  );
};

export default SpecificCodesDualList;