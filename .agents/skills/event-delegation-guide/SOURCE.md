# Event Delegation Pattern in React

## Overview

Event delegation is a pattern where instead of attaching event handlers to individual child elements, you attach a single handler to a parent container. This eliminates the need to pass event handlers through props of all nested components.

## Core Principle

Instead of passing handlers through multiple levels of component props, attach a single event listener to a parent container and use `event.target` to identify which child element triggered the event.

## Basic Implementation

### Without Event Delegation (Prop Drilling)

```
const Parent = () => {
  const handleClick = (id: string) => {
    console.log(id);
  };

  return <Middle onItemClick={handleClick} />;
};

const Middle = ({ onItemClick }: TMiddleProps) => {
  return <Child onItemClick={onItemClick} />;
};

const Child = ({ onItemClick }: TChildProps) => {
  return <button onClick={() => onItemClick('item-1')}>Click</button>;
};
```

### With Event Delegation

```
const Parent = () => {
  const handleContainerClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const button = target.closest('[data-action]');
    
    if (button) {
      const action = button.getAttribute('data-action');
      const id = button.getAttribute('data-id');
      console.log(action, id);
    }
  };

  return (
    <div onClick={handleContainerClick}>
      <Middle />
    </div>
  );
};

const Middle = () => {
  return <Child />;
};

const Child = () => {
  return (
    <button data-action="click" data-id="item-1">
      Click
    </button>
  );
};
```

## Use Cases

### 1. Lists with Multiple Actions

When rendering lists where each item has multiple interactive elements.

```
const ItemList = () => {
  const { items, handleAction } = useItemList();

  const handleDelegatedClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const actionElement = target.closest('[data-action]');
    
    if (!actionElement) return;
    
    const action = actionElement.getAttribute('data-action');
    const itemId = actionElement.getAttribute('data-item-id');
    
    if (action && itemId) {
      handleAction(action, itemId);
    }
  };

  return (
    <div onClick={handleDelegatedClick}>
      {items.map(item => (
        <ListItem key={item.id} item={item} />
      ))}
    </div>
  );
};

const ListItem = ({ item }: TListItemProps) => {
  return (
    <div>
      <button data-action="edit" data-item-id={item.id}>
        Edit
      </button>
      <button data-action="delete" data-item-id={item.id}>
        Delete
      </button>
      <button data-action="share" data-item-id={item.id}>
        Share
      </button>
    </div>
  );
};
```

### 2. Dynamic Content

When content is added or removed dynamically without re-rendering.

```
const DynamicContainer = () => {
  const handleDelegatedEvent = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const clickable = target.closest('[data-clickable]');
    
    if (clickable) {
      const elementId = clickable.getAttribute('data-element-id');
      console.log('Clicked element:', elementId);
    }
  };

  return (
    <div onClick={handleDelegatedEvent}>
      <DynamicContent />
    </div>
  );
};
```

### 3. Forms with Multiple Inputs

When handling multiple form inputs without individual handlers.

```
const FormContainer = () => {
  const { formData, updateField } = useFormData();

  const handleInputChange = (event: React.ChangeEvent<HTMLDivElement>) => {
    const target = event.target as HTMLInputElement;
    
    if (target.hasAttribute('data-field')) {
      const field = target.getAttribute('data-field');
      if (field) {
        updateField(field, target.value);
      }
    }
  };

  return (
    <div onChange={handleInputChange}>
      <FormFields />
    </div>
  );
};

const FormFields = () => {
  return (
    <>
      <input data-field="name" type="text" />
      <input data-field="email" type="email" />
      <input data-field="phone" type="tel" />
    </>
  );
};
```

### 4. Nested Navigation Menus

When building complex navigation structures.

```
const Navigation = () => {
  const { navigate } = useNavigation();

  const handleNavigationClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const link = target.closest('[data-route]');
    
    if (link) {
      event.preventDefault();
      const route = link.getAttribute('data-route');
      if (route) {
        navigate(route);
      }
    }
  };

  return (
    <nav onClick={handleNavigationClick}>
      <MenuLevel1 />
    </nav>
  );
};

const MenuLevel1 = () => {
  return (
    <ul>
      <li>
        <a data-route="/home">Home</a>
        <MenuLevel2 />
      </li>
    </ul>
  );
};

const MenuLevel2 = () => {
  return (
    <ul>
      <li><a data-route="/about">About</a></li>
      <li><a data-route="/contact">Contact</a></li>
    </ul>
  );
};
```

### 5. Cards with Multiple Interactive Zones

When card components have multiple clickable areas with different actions.

```
const CardGrid = () => {
  const handleCardInteraction = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const actionElement = target.closest('[data-card-action]');
    
    if (actionElement) {
      const action = actionElement.getAttribute('data-card-action');
      const cardId = actionElement.getAttribute('data-card-id');
      
      if (action === 'view') {
        console.log('View card:', cardId);
      } else if (action === 'favorite') {
        console.log('Favorite card:', cardId);
      } else if (action === 'settings') {
        console.log('Settings for card:', cardId);
      }
    }
  };

  return (
    <div onClick={handleCardInteraction}>
      <Card id="1" />
      <Card id="2" />
      <Card id="3" />
    </div>
  );
};

const Card = ({ id }: TCardProps) => {
  return (
    <div data-card-action="view" data-card-id={id}>
      <CardHeader id={id} />
      <CardBody />
      <CardFooter id={id} />
    </div>
  );
};

const CardHeader = ({ id }: TCardHeaderProps) => {
  return (
    <div>
      <button 
        data-card-action="favorite" 
        data-card-id={id}
        onClick={(e) => e.stopPropagation()}
      >
        ★
      </button>
    </div>
  );
};

const CardFooter = ({ id }: TCardFooterProps) => {
  return (
    <button 
      data-card-action="settings" 
      data-card-id={id}
      onClick={(e) => e.stopPropagation()}
    >
      Settings
    </button>
  );
};
```

## Advanced Patterns

### Multiple Event Types

```
const MultiEventContainer = () => {
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const element = target.closest('[data-click-action]');
    
    if (element) {
      const action = element.getAttribute('data-click-action');
      console.log('Click action:', action);
    }
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const element = target.closest('[data-dblclick-action]');
    
    if (element) {
      const action = element.getAttribute('data-dblclick-action');
      console.log('Double click action:', action);
    }
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const element = target.closest('[data-context-action]');
    
    if (element) {
      event.preventDefault();
      const action = element.getAttribute('data-context-action');
      console.log('Context menu action:', action);
    }
  };

  return (
    <div 
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      <Content />
    </div>
  );
};
```

### Event Delegation with State Management

```
const DataTable = () => {
  const { 
    rows, 
    selectedRows, 
    sortColumn, 
    handleRowSelect, 
    handleSort, 
    handleRowAction 
  } = useDataTable();

  const handleTableClick = (event: React.MouseEvent<HTMLTableElement>) => {
    const target = event.target as HTMLElement;
    
    const checkbox = target.closest('[data-select]');
    if (checkbox) {
      const rowId = checkbox.getAttribute('data-row-id');
      if (rowId) {
        handleRowSelect(rowId);
        return;
      }
    }
    
    const sortHeader = target.closest('[data-sort]');
    if (sortHeader) {
      const column = sortHeader.getAttribute('data-column');
      if (column) {
        handleSort(column);
        return;
      }
    }
    
    const actionButton = target.closest('[data-row-action]');
    if (actionButton) {
      const action = actionButton.getAttribute('data-row-action');
      const rowId = actionButton.getAttribute('data-row-id');
      if (action && rowId) {
        handleRowAction(action, rowId);
      }
    }
  };

  return (
    <table onClick={handleTableClick}>
      <TableHeader sortColumn={sortColumn} />
      <tbody>
        {rows.map(row => (
          <TableRow 
            key={row.id} 
            row={row} 
            isSelected={selectedRows.includes(row.id)} 
          />
        ))}
      </tbody>
    </table>
  );
};

const TableHeader = ({ sortColumn }: TTableHeaderProps) => {
  return (
    <thead>
      <tr>
        <th data-sort data-column="name">Name</th>
        <th data-sort data-column="date">Date</th>
        <th data-sort data-column="status">Status</th>
      </tr>
    </thead>
  );
};

const TableRow = ({ row, isSelected }: TTableRowProps) => {
  return (
    <tr>
      <td>
        <input 
          type="checkbox" 
          data-select 
          data-row-id={row.id}
          checked={isSelected}
          readOnly
        />
      </td>
      <td>{row.name}</td>
      <td>{row.date}</td>
      <td>
        <button data-row-action="edit" data-row-id={row.id}>Edit</button>
        <button data-row-action="delete" data-row-id={row.id}>Delete</button>
      </td>
    </tr>
  );
};
```

## Best Practices

### 1. Use Data Attributes

Always use data attributes to identify actionable elements and carry metadata.

```
<button data-action="submit" data-form-id="user-form">Submit</button>
```

### 2. Use `closest()` Method

Use `closest()` to find the target element even if the click occurred on a child element.

```
const button = (event.target as HTMLElement).closest('[data-action]');
```

### 3. Stop Propagation When Needed

Prevent event bubbling for nested interactive elements.

```
<button onClick={(e) => e.stopPropagation()}>Nested Action</button>
```

### 4. Type Safety

Always cast event targets and check for null values.

```
const target = event.target as HTMLElement;
const element = target.closest('[data-action]');

if (element) {
  const action = element.getAttribute('data-action');
  if (action) {
    handleAction(action);
  }
}
```

### 5. Performance Consideration

Event delegation reduces the number of event listeners but adds a small overhead for event matching. Use it when you have many similar elements.

## When to Use Event Delegation

✅ **Use when:**
- You have deeply nested component trees
- You render large lists with interactive elements
- You have dynamic content that changes frequently
- You want to avoid prop drilling
- You have multiple similar elements with similar handlers

❌ **Avoid when:**
- You need complex event-specific logic for each element
- You need to prevent default behavior selectively
- Performance of event matching becomes a bottleneck
- Component tree is shallow and props are easy to pass

## Common Pitfalls

### 1. Forgetting to Stop Propagation

When you have nested clickable elements, remember to stop propagation to prevent triggering multiple handlers.

```
<div data-action="parent-action">
  <button 
    data-action="child-action"
    onClick={(e) => e.stopPropagation()}
  >
    Child
  </button>
</div>
```

### 2. Not Checking for Null

Always check if `closest()` or `getAttribute()` returns a value.

```
const element = target.closest('[data-action]');
if (!element) return;

const action = element.getAttribute('data-action');
if (!action) return;
```

### 3. Using Event Delegation for Everything

Don't overuse event delegation. For simple cases with few components, direct props are clearer.

## Implementation Checklist

- Identify the common parent container
- Add single event handler to parent
- Add data attributes to child elements
- Use `closest()` to find target elements
- Extract and validate data attributes
- Handle null cases properly
- Add `stopPropagation()` where needed
- Test with nested interactive elements