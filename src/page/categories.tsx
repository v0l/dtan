import { Link } from "react-router-dom";
import { Categories, Category } from "../const";
import { useHead } from "../ssr";

export function CategoriesPage() {
  useHead({ title: "Categories", description: "Browse torrents on Nostr by category", path: "/categories" });
  // Recursively render a category and all its subcategories
  const renderCategory = (category: Category, parentPath: string[] = []): React.ReactNode[] => {
    const categoryPath = [...parentPath, category.tag];
    const tcatString = categoryPath.join(",");
    const results: React.ReactNode[] = [];

    // Render this category as a link
    results.push(
      <Link
        key={tcatString}
        to={`/search?i=tcat:${tcatString}`}
        className="text-blue-400 hover:text-blue-300 hover:underline"
      >
        {category.name}
      </Link>,
    );

    // If there are subcategories, recursively render them
    if (category.sub_category && category.sub_category.length > 0) {
      for (let i = 0; i < category.sub_category.length; i++) {
        // Add separator before each subcategory
        results.push(
          <span key={`sep-${tcatString}-${i}`} className="text-neutral-500 mx-2">
            •
          </span>,
        );
        results.push(...renderCategory(category.sub_category[i], categoryPath));
      }
    }

    return results;
  };

  // Split categories into two columns for TPB-style layout
  const midpoint = Math.ceil(Categories.length / 2);
  const leftCategories = Categories.slice(0, midpoint);
  const rightCategories = Categories.slice(midpoint);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Browse Torrents</h1>

      {/* TPB-style category browse layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left column */}
        <div className="flex flex-col gap-8">
          {leftCategories.map((category) => (
            <dl key={category.tag}>
              <dt className="mb-2">
                <Link
                  to={`/search?tags=${category.tag}`}
                  className="text-lg font-bold text-blue-400 hover:text-blue-300 hover:underline"
                >
                  {category.name}
                </Link>
              </dt>
              <dd className="ml-4 flex flex-wrap items-baseline gap-x-1">
                {category.sub_category && category.sub_category.length > 0 ? (
                  category.sub_category.map((sub, idx) => (
                    <span key={sub.tag} className="inline-flex flex-wrap items-baseline">
                      {idx > 0 && <span className="text-neutral-500 mx-2">•</span>}
                      {renderCategory(sub, [category.tag])}
                    </span>
                  ))
                ) : (
                  <Link
                    to={`/search?tags=${category.tag}`}
                    className="text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    Browse {category.name}
                  </Link>
                )}
              </dd>
            </dl>
          ))}
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-8">
          {rightCategories.map((category) => (
            <dl key={category.tag}>
              <dt className="mb-2">
                <Link
                  to={`/search?tags=${category.tag}`}
                  className="text-lg font-bold text-blue-400 hover:text-blue-300 hover:underline"
                >
                  {category.name}
                </Link>
              </dt>
              <dd className="ml-4 flex flex-wrap items-baseline gap-x-1">
                {category.sub_category && category.sub_category.length > 0 ? (
                  category.sub_category.map((sub, idx) => (
                    <span key={sub.tag} className="inline-flex flex-wrap items-baseline">
                      {idx > 0 && <span className="text-neutral-500 mx-2">•</span>}
                      {renderCategory(sub, [category.tag])}
                    </span>
                  ))
                ) : (
                  <Link
                    to={`/search?tags=${category.tag}`}
                    className="text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    Browse {category.name}
                  </Link>
                )}
              </dd>
            </dl>
          ))}
        </div>
      </div>
    </div>
  );
}
