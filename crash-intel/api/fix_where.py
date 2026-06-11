"""Quick fix: replace make_clause pattern with direct clauses approach"""
import re

with open('/root/acg-command-center/crash-intel/api/server.py', 'r') as f:
    content = f.read()

# Replace the make_clause section
old = '''    # Vehicle make
    make_clause = ""
    make_params = []
    if filters.get('make'):
        makes = filters['make'] if isinstance(filters['make'], list) else [filters['make']]
        placeholders = ','.join(['?' for _ in makes])
        make_clause = f"""AND EXISTS (
            SELECT 1 FROM parties p2
            WHERE p2.collision_id = c.collision_id
            AND (p2.vehicle_make_code IN ({placeholders})
                 OR p2.vehicle2_make_code IN ({placeholders}))
        )"""
        make_params = makes + makes  # repeated for vehicle2'''

new = '''    # Vehicle make
    if filters.get('make'):
        makes = filters['make'] if isinstance(filters['make'], list) else [filters['make']]
        placeholders = ','.join(['?' for _ in makes])
        clauses.append("EXISTS (SELECT 1 FROM parties p2 WHERE p2.collision_id = c.collision_id AND (p2.vehicle_make_code IN (" + placeholders + ") OR p2.vehicle2_make_code IN (" + placeholders + ")))")
        params.extend(makes + makes)'''

content = content.replace(old, new)

# Replace the where return logic
old_ret = '''    where = "WHERE " + " AND ".join(clauses) if clauses else ""
    if where and make_clause:
        return where + " " + make_clause, params + make_params
    elif make_clause:
        # make_clause starts with AND or WHERE
        return "WHERE " + make_clause[4:] if make_clause.startswith("AND ") else make_clause, params + make_params
    return where, params + make_params'''

new_ret = '''    where = "WHERE " + " AND ".join(clauses) if clauses else ""
    return where, params'''

content = content.replace(old_ret, new_ret)

with open('/root/acg-command-center/crash-intel/api/server.py', 'w') as f:
    f.write(content)

print("✅ Fixed build_where")
