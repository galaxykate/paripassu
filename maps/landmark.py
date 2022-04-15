import json
import os

location = "nu"

print(os.listdir())
landmarks = json.load(open(f"landmarks-all-{location}.geojson"))["features"]
print(len(landmarks))


# Is this a useful landmark?
def is_interesting(landmark):
	keys = landmark["properties"].keys()
	keys = [k for k in keys if k not in ['@id', 'curve_geometry']]
	return len(keys) > 0

# Is this a useful landmark?
def has_prop(landmark, prop):
	return prop in landmark["properties"].keys()

all_interesting = [l for l in landmarks if is_interesting(l)]



json.dump(all_interesting, open(f"landmarks-interesting-{location}.json", "w"), indent = 6)

# for key in ["shop", "natural", "highway", "curve_geometry"]:
# 	matching = [l for l in landmarks if has_prop(l, key)]
# 	json.dump(matching, open(f"landmarks-{key}-{location}.json", "w"), indent = 6)
