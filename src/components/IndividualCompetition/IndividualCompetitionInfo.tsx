import { competitionPageConfig } from '../../config/competitionPageConfig';

// Text overrides for visual editor live preview
export interface CompetitionPageTextOverrides {
  ticketNumbersDescription?: string;
  picturesDisclaimer?: string;
  minimumWinText?: string;
  additionalInfo?: string;
}

interface IndividualCompetitionInfoProps {
  // Optional text overrides for visual editor live preview
  textOverrides?: CompetitionPageTextOverrides;
}

const IndividualCompetitionInfo = ({ textOverrides }: IndividualCompetitionInfoProps) => {
    // Use textOverrides from editor if provided, otherwise use live site config
    const config = textOverrides || competitionPageConfig;

    // Don't render anything if all text fields are empty
    const hasContent = config.ticketNumbersDescription || config.picturesDisclaimer || config.minimumWinText || config.additionalInfo;
    if (!hasContent) return null;

    return (
        <div className="text-white text-center max-w-7xl mx-auto">
            {/* Competition Title removed - was useless placeholder text */}
            <div className="sequel-45 leading-loose my-8 lg:text-lg text-center xl:w-9/12 mx-auto">
                {config.ticketNumbersDescription && <p>{config.ticketNumbersDescription}</p>}
                {config.picturesDisclaimer && <p>{config.picturesDisclaimer}</p>}
                {config.additionalInfo && (
                    <p>{config.additionalInfo}</p>
                )}
            </div>
            {config.minimumWinText && (
                <p className="sequel-75 mt-6 lg:text-lg">
                    {config.minimumWinText}
                </p>
            )}
        </div>
    )
}

export default IndividualCompetitionInfo