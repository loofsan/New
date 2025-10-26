import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { scenarios } from '@/lib/scenarios';
import { ArrowLeft, Clock, Users } from 'lucide-react';

export default function ScenariosPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link href="/">
            <Button variant="ghost" className="mb-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </Link>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Choose Your Scenario
          </h1>
          <p className="text-gray-600">
            Select a practice scenario to begin improving your public speaking skills
          </p>
        </div>

        {/* Scenarios Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {scenarios.map((scenario) => (
            <Card key={scenario.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="text-5xl mb-4">{scenario.icon}</div>
                <CardTitle className="flex items-center justify-between">
                  {scenario.title}
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    scenario.difficulty === 'easy' ? 'bg-green-100 text-green-700' :
                    scenario.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {scenario.difficulty.toUpperCase()}
                  </span>
                </CardTitle>
                <CardDescription>{scenario.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm text-gray-600 mb-4">
                  <div className="flex items-center">
                    <Users className="w-4 h-4 mr-1" />
                    {scenario.participantCount} participants
                  </div>
                  <div className="flex items-center">
                    <Clock className="w-4 h-4 mr-1" />
                    {Math.floor(scenario.duration / 60)} min
                  </div>
                </div>
                <Link href={`/practice/${scenario.id}/setup`}>
                  <Button className="w-full">
                    Start Practice
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}